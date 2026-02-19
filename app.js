const STORAGE_KEY = "breath-meditation-settings-v1";

const PHASES = [
  { key: "inhale", label: "吸气", type: "inhale", durationKey: "inhaleSeconds" },
  { key: "hold1", label: "暂停（吸后）", type: "hold", durationKey: "hold1Seconds" },
  { key: "exhale", label: "呼气", type: "exhale", durationKey: "exhaleSeconds" },
  { key: "hold2", label: "暂停（呼后）", type: "hold", durationKey: "hold2Seconds" }
];

const SAMPLE_FILES = {
  exhale: "assets/audio/exhale-light-short.mp3"
};

const elements = {
  appRoot: document.getElementById("app-root"),
  controlsPanel: document.getElementById("controls-panel"),
  settingsBody: document.getElementById("settings-body"),
  toggleSettingsButton: document.getElementById("toggle-settings-button"),
  settingsSummary: document.getElementById("settings-summary"),
  rhythmSummary: document.getElementById("rhythm-summary"),
  form: document.getElementById("settings-form"),
  inhale: document.getElementById("inhale-seconds"),
  hold1: document.getElementById("hold1-seconds"),
  exhale: document.getElementById("exhale-seconds"),
  hold2: document.getElementById("hold2-seconds"),
  totalMinutes: document.getElementById("total-minutes"),
  volume: document.getElementById("volume"),
  mute: document.getElementById("mute"),
  startButton: document.getElementById("start-button"),
  pauseButton: document.getElementById("pause-button"),
  resumeButton: document.getElementById("resume-button"),
  stopButton: document.getElementById("stop-button"),
  downloadMixButton: document.getElementById("download-mix-button"),
  phaseName: document.getElementById("phase-name"),
  phaseRemaining: document.getElementById("phase-remaining"),
  totalRemaining: document.getElementById("total-remaining"),
  feedback: document.getElementById("feedback"),
  downloadStatus: document.getElementById("download-status"),
  downloadProgress: document.getElementById("download-progress"),
  sessionPanel: document.getElementById("session-panel"),
  orbWrapper: document.getElementById("orb-wrapper"),
  orb: document.getElementById("breath-orb")
};

const state = {
  runState: "idle",
  settings: null,
  phaseIndex: -1,
  phaseEndAtMs: 0,
  phaseDurationMs: 0,
  sessionStartMs: 0,
  totalPausedMs: 0,
  pausedAtMs: 0,
  elapsedWhenPausedMs: 0,
  totalDurationMs: 0,
  setupSettingsCollapsed: false,
  stopAfterCycle: false,
  timerId: null,
  currentOrbScale: 1,
  lastMotionDirection: "none",
  exportInProgress: false
};

class BreathAudio {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.effectInput = null;
    this.sampleElements = {};
    this.activeSamplePlayers = new Map();
    this.rainNodes = null;
    this.rainBuffer = null;
    this.volume = 0.8;
    this.muted = false;
  }

  async unlock() {
    if (!this.context) {
      this.context = new window.AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.connect(this.context.destination);
      this.createSpaceEffect();
      this.applyGain();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.prepareSampleElements();
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    this.applyGain();
    this.updateActiveSampleLevels();
  }

  setMuted(flag) {
    this.muted = Boolean(flag);
    this.applyGain();
    this.updateActiveSampleLevels();
  }

  applyGain() {
    if (!this.masterGain) {
      return;
    }
    const now = this.context.currentTime;
    const level = this.muted ? 0 : this.volume;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(level, now, 0.08);
  }

  createSpaceEffect() {
    const delay = this.context.createDelay(2.0);
    const feedback = this.context.createGain();
    const dampFilter = this.context.createBiquadFilter();
    const wetGain = this.context.createGain();

    this.effectInput = this.context.createGain();
    this.effectInput.gain.value = 0.85;
    feedback.gain.value = 0.32;
    delay.delayTime.value = 0.23;
    dampFilter.type = "lowpass";
    dampFilter.frequency.value = 2600;
    wetGain.gain.value = 0.36;

    this.effectInput.connect(delay);
    delay.connect(dampFilter);
    dampFilter.connect(feedback);
    feedback.connect(delay);
    delay.connect(wetGain);
    wetGain.connect(this.masterGain);
  }

  connectWithSpace(node, wetLevel = 0.42) {
    const dryGain = this.context.createGain();
    dryGain.gain.value = 1;
    node.connect(dryGain);
    dryGain.connect(this.masterGain);

    if (this.effectInput) {
      const sendGain = this.context.createGain();
      sendGain.gain.value = clamp(wetLevel, 0, 1);
      node.connect(sendGain);
      sendGain.connect(this.effectInput);
    }
  }

  prepareSampleElements() {
    for (const [key, path] of Object.entries(SAMPLE_FILES)) {
      if (this.sampleElements[key]) {
        continue;
      }
      try {
        const audio = new Audio(path);
        audio.preload = "auto";
        this.sampleElements[key] = audio;
      } catch (error) {
        continue;
      }
    }
  }

  updateActiveSampleLevels() {
    for (const [player, meta] of this.activeSamplePlayers.entries()) {
      if (player.ended || player.paused) {
        if (meta.stopTimer) {
          window.clearTimeout(meta.stopTimer);
        }
        this.activeSamplePlayers.delete(player);
        continue;
      }
      player.volume = this.muted ? 0 : clamp(this.volume * meta.gainLevel, 0, 1);
      player.muted = this.muted;
    }

    if (this.rainNodes && this.context) {
      const now = this.context.currentTime;
      const baseGain = this.muted ? 0 : this.getRainGainLevel();
      this.rainNodes.gain.gain.setTargetAtTime(baseGain, now, 0.08);
      this.rainNodes.flutterGain.gain.setTargetAtTime(baseGain * 0.18, now, 0.08);
    }
  }

  playSample(key, gainLevel = 1, maxDurationSec = null) {
    const template = this.sampleElements[key];
    if (!template) {
      return false;
    }
    let player = null;
    try {
      player = template.cloneNode(true);
      player.volume = this.muted ? 0 : clamp(this.volume * gainLevel, 0, 1);
      player.muted = this.muted;
      const meta = { gainLevel, stopTimer: null };
      this.activeSamplePlayers.set(player, meta);
      const cleanup = () => {
        const current = this.activeSamplePlayers.get(player);
        if (current && current.stopTimer) {
          window.clearTimeout(current.stopTimer);
        }
        this.activeSamplePlayers.delete(player);
        try {
          player.pause();
          player.currentTime = 0;
        } catch (error) {
          return;
        }
      };
      player.addEventListener("ended", cleanup, { once: true });
      player.addEventListener("error", cleanup, { once: true });
      if (Number.isFinite(maxDurationSec) && maxDurationSec > 0) {
        meta.stopTimer = window.setTimeout(
          cleanup,
          Math.max(40, Math.round(maxDurationSec * 1000))
        );
      }
      const maybePromise = player.play();
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => cleanup());
      }
    } catch (error) {
      if (player) {
        this.activeSamplePlayers.delete(player);
      }
      return false;
    }
    return true;
  }

  playPhase(type, phaseDurationSec = null) {
    if (!this.context || this.context.state !== "running") {
      return;
    }

    if (type === "inhale") {
      this.playHoldDrop();
      return;
    }
    if (type === "hold") {
      this.playInhaleLowDrum();
      return;
    }
    if (type === "exhale") {
      if (!this.playSample("exhale", 0.95, phaseDurationSec)) {
        this.playExhaleFallback();
      }
    }
  }

  getRainGainLevel() {
    return clamp(this.volume * 0.22, 0, 0.4);
  }

  startRain() {
    if (!this.context || this.context.state !== "running" || this.rainNodes) {
      return;
    }
    if (!this.rainBuffer) {
      this.rainBuffer = createRainNoiseBuffer(this.context, 2.4);
    }

    const source = this.context.createBufferSource();
    const highpass = this.context.createBiquadFilter();
    const lowpass = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const flutter = this.context.createOscillator();
    const flutterGain = this.context.createGain();
    const now = this.context.currentTime;
    const baseGain = this.muted ? 0 : this.getRainGainLevel();

    source.buffer = this.rainBuffer;
    source.loop = true;
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(900, now);
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(6200, now);
    gain.gain.setValueAtTime(baseGain, now);

    flutter.type = "sine";
    flutter.frequency.setValueAtTime(0.24, now);
    flutterGain.gain.setValueAtTime(baseGain * 0.18, now);

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.masterGain);
    flutter.connect(flutterGain);
    flutterGain.connect(gain.gain);

    source.start(now);
    flutter.start(now);
    this.rainNodes = { source, gain, flutter, flutterGain };
  }

  pauseRain() {
    this.stopRain();
  }

  resumeRain() {
    this.startRain();
  }

  stopRain() {
    if (!this.rainNodes) {
      return;
    }
    const now = this.context ? this.context.currentTime : 0;
    try {
      this.rainNodes.gain.gain.setTargetAtTime(0.0001, now, 0.04);
      this.rainNodes.flutterGain.gain.setTargetAtTime(0.0001, now, 0.04);
      this.rainNodes.source.stop(now + 0.07);
      this.rainNodes.flutter.stop(now + 0.07);
    } catch (error) {
      return;
    } finally {
      this.rainNodes = null;
    }
  }

  playHoldDrop() {
    const now = this.context.currentTime;
    const drop = this.context.createOscillator();
    const tail = this.context.createOscillator();
    const dropGain = this.context.createGain();
    const tailGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const mix = this.context.createGain();

    drop.type = "sine";
    tail.type = "triangle";
    drop.frequency.setValueAtTime(980, now);
    drop.frequency.exponentialRampToValueAtTime(410, now + 0.2);
    tail.frequency.setValueAtTime(560, now + 0.02);
    tail.frequency.exponentialRampToValueAtTime(300, now + 1.0);

    dropGain.gain.setValueAtTime(0.0001, now);
    dropGain.gain.linearRampToValueAtTime(0.3, now + 0.01);
    dropGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    tailGain.gain.setValueAtTime(0.0001, now);
    tailGain.gain.linearRampToValueAtTime(0.13, now + 0.04);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);

    filter.type = "bandpass";
    filter.frequency.value = 1050;
    filter.Q.value = 7.5;

    drop.connect(filter);
    filter.connect(dropGain);
    tail.connect(tailGain);
    dropGain.connect(mix);
    tailGain.connect(mix);

    this.connectWithSpace(mix, 0.38);
    drop.start(now);
    tail.start(now);
    drop.stop(now + 0.34);
    tail.stop(now + 1.08);
  }

  playInhaleLowDrum() {
    const now = this.context.currentTime;
    const strike = this.context.createOscillator();
    const resonance = this.context.createOscillator();
    const strikeGain = this.context.createGain();
    const resonanceGain = this.context.createGain();
    const tone = this.context.createBiquadFilter();
    const mix = this.context.createGain();

    strike.type = "triangle";
    resonance.type = "sine";

    strike.frequency.setValueAtTime(190, now);
    strike.frequency.exponentialRampToValueAtTime(82, now + 0.2);
    resonance.frequency.setValueAtTime(120, now + 0.02);
    resonance.frequency.exponentialRampToValueAtTime(68, now + 1.0);

    strikeGain.gain.setValueAtTime(0.0001, now);
    strikeGain.gain.linearRampToValueAtTime(0.3, now + 0.01);
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    resonanceGain.gain.setValueAtTime(0.0001, now);
    resonanceGain.gain.linearRampToValueAtTime(0.13, now + 0.04);
    resonanceGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);

    tone.type = "lowpass";
    tone.frequency.value = 340;
    tone.Q.value = 1.05;

    strike.connect(strikeGain);
    resonance.connect(resonanceGain);
    strikeGain.connect(mix);
    resonanceGain.connect(mix);
    mix.connect(tone);

    this.connectWithSpace(tone, 0.38);
    strike.start(now);
    resonance.start(now);
    strike.stop(now + 0.34);
    resonance.stop(now + 1.08);
  }

  playExhaleFallback() {
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const mix = this.context.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(560, now + 0.9);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);

    osc.connect(gain);
    gain.connect(mix);
    this.connectWithSpace(mix, 0.26);
    osc.start(now);
    osc.stop(now + 1.05);
  }
}

function createRainNoiseBuffer(audioContext, durationSec) {
  const safeDuration = Math.max(0.8, durationSec);
  const frameCount = Math.floor(audioContext.sampleRate * safeDuration);
  const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
  const channel = buffer.getChannelData(0);
  let previous = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const white = Math.random() * 2 - 1;
    previous = previous * 0.985 + white * 0.17;
    channel[index] = previous;
  }
  return buffer;
}

const audio = new BreathAudio();

initialize();

function initialize() {
  loadSettings();
  updateSettingsSummary();
  bindEvents();
  setSettingsCollapsed(state.setupSettingsCollapsed);
  renderIdleView();
  updateButtons();
}

function bindEvents() {
  elements.startButton.addEventListener("click", handleStart);
  elements.pauseButton.addEventListener("click", handlePause);
  elements.resumeButton.addEventListener("click", handleResume);
  elements.stopButton.addEventListener("click", handleStopReset);
  elements.downloadMixButton.addEventListener("click", handleDownloadMix);
  elements.toggleSettingsButton.addEventListener("click", handleToggleSettings);

  elements.form.addEventListener("input", () => {
    if (state.runState === "idle" || state.runState === "finished") {
      clearFeedback();
    }
    updateSettingsSummary();
    saveSettings();
  });

  elements.volume.addEventListener("input", () => {
    const volume = Number(elements.volume.value) / 100;
    audio.setVolume(volume);
    updateSettingsSummary();
    saveSettings();
  });

  elements.mute.addEventListener("change", () => {
    audio.setMuted(elements.mute.checked);
    updateSettingsSummary();
    saveSettings();
  });
}

function handleToggleSettings() {
  if (isSessionActive()) {
    return;
  }
  state.setupSettingsCollapsed = !state.setupSettingsCollapsed;
  setSettingsCollapsed(state.setupSettingsCollapsed);
}

async function handleStart() {
  const parsed = parseAndValidateSettings();
  if (!parsed.ok) {
    setFeedback(parsed.message, true);
    return;
  }

  try {
    await audio.unlock();
  } catch (error) {
    setFeedback("声音初始化失败，请检查浏览器设置。", true);
    return;
  }

  state.settings = parsed.settings;
  state.totalDurationMs = state.settings.totalMinutes * 60_000;
  state.phaseIndex = -1;
  state.stopAfterCycle = false;
  state.runState = "running";
  state.sessionStartMs = performance.now();
  state.totalPausedMs = 0;
  state.pausedAtMs = 0;
  state.elapsedWhenPausedMs = 0;
  state.currentOrbScale = 1;
  state.lastMotionDirection = "none";

  audio.setVolume(state.settings.volume / 100);
  audio.setMuted(state.settings.mute);
  audio.startRain();

  clearFeedback();
  advancePhase(performance.now());
  startTicker();
  focusSessionPanel();
  setFeedback("已开始练习，参数已锁定。");
  updateButtons();
}

function handlePause() {
  if (state.runState !== "running") {
    return;
  }
  state.runState = "paused";
  state.pausedAtMs = performance.now();
  state.elapsedWhenPausedMs = getElapsedMs(state.pausedAtMs);
  stopTicker();
  audio.pauseRain();
  setFeedback("已暂停");
  updateButtons();
}

function handleResume() {
  if (state.runState !== "paused") {
    return;
  }
  const nowMs = performance.now();
  const pauseDelta = nowMs - state.pausedAtMs;
  state.totalPausedMs += pauseDelta;
  state.phaseEndAtMs += pauseDelta;
  state.pausedAtMs = 0;
  state.runState = "running";
  audio.resumeRain();
  clearFeedback();
  startTicker();
  updateButtons();
}

function handleStopReset() {
  resetToIdle();
}

function startTicker() {
  stopTicker();
  state.timerId = window.setInterval(tick, 120);
  tick();
}

function stopTicker() {
  if (state.timerId !== null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function tick() {
  if (state.runState !== "running") {
    return;
  }

  const nowMs = performance.now();
  const elapsedMs = getElapsedMs(nowMs);

  if (elapsedMs >= state.totalDurationMs && !state.stopAfterCycle) {
    state.stopAfterCycle = true;
    setFeedback("总时长已到，当前轮结束后自动停止。");
  }

  let guard = 0;
  while (nowMs >= state.phaseEndAtMs && state.runState === "running" && guard < 8) {
    const hasNext = advancePhase(nowMs);
    guard += 1;
    if (!hasNext) {
      break;
    }
  }

  if (state.runState === "running") {
    renderSession(nowMs);
  }
}

function advancePhase(nowMs) {
  let guard = 0;
  while (guard < 8) {
    const nextIndex = (state.phaseIndex + 1) % PHASES.length;

    if (state.stopAfterCycle && nextIndex === 0 && state.phaseIndex !== -1) {
      finishSession();
      return false;
    }

    state.phaseIndex = nextIndex;
    const phase = PHASES[state.phaseIndex];
    const durationSec = state.settings[phase.durationKey];

    if (durationSec <= 0) {
      guard += 1;
      continue;
    }

    state.phaseDurationMs = durationSec * 1000;
    state.phaseEndAtMs = nowMs + state.phaseDurationMs;
    updatePhaseVisual(phase, durationSec);
    audio.playPhase(phase.type, durationSec);
    renderSession(nowMs);
    return true;
  }

  finishSession();
  return false;
}

function updatePhaseVisual(phase, durationSec) {
  elements.phaseName.textContent = phase.label;
  setOrbPhase(phase.type);

  if (phase.type === "inhale") {
    state.lastMotionDirection = "expand";
    setOrbScale(1.24, durationSec);
    return;
  }
  if (phase.type === "exhale") {
    state.lastMotionDirection = "shrink";
    setOrbScale(0.84, durationSec);
    return;
  }

  if (state.lastMotionDirection === "expand") {
    setOrbScale(1.34, durationSec);
    return;
  }
  if (state.lastMotionDirection === "shrink") {
    setOrbScale(0.74, durationSec);
    return;
  }
  setOrbScale(state.currentOrbScale, durationSec);
}

function setOrbScale(targetScale, seconds) {
  state.currentOrbScale = targetScale;
  elements.orb.style.setProperty("--phase-duration", `${Math.max(seconds, 0.12)}s`);
  elements.orb.style.setProperty("--orb-scale", targetScale.toFixed(3));
}

function setOrbPhase(type) {
  elements.orbWrapper.classList.remove("phase-idle", "phase-inhale", "phase-hold", "phase-exhale");
  if (type === "inhale") {
    elements.orbWrapper.classList.add("phase-inhale");
    return;
  }
  if (type === "exhale") {
    elements.orbWrapper.classList.add("phase-exhale");
    return;
  }
  elements.orbWrapper.classList.add("phase-hold");
}

function renderSession(nowMs) {
  const phaseRemainingMs = Math.max(0, state.phaseEndAtMs - nowMs);
  const totalRemainingMs = Math.max(0, state.totalDurationMs - getElapsedMs(nowMs));
  elements.phaseRemaining.textContent = `阶段剩余 ${formatMs(phaseRemainingMs)}`;
  elements.totalRemaining.textContent = `总剩余 ${formatMs(totalRemainingMs)}`;
}

function renderIdleView() {
  setOrbPhase("idle");
  setOrbScale(1, 0.24);
  elements.phaseName.textContent = "未开始";
  elements.phaseRemaining.textContent = "阶段剩余 00:00";
  elements.totalRemaining.textContent = "总剩余 00:00";
}

function finishSession() {
  state.runState = "finished";
  stopTicker();
  audio.stopRain();
  setOrbPhase("idle");
  setFeedback("本次练习完成。");
  updateButtons();
  const nowMs = performance.now();
  renderSession(nowMs);
}

function resetToIdle() {
  state.runState = "idle";
  state.settings = null;
  state.phaseIndex = -1;
  state.phaseEndAtMs = 0;
  state.phaseDurationMs = 0;
  state.sessionStartMs = 0;
  state.totalPausedMs = 0;
  state.pausedAtMs = 0;
  state.elapsedWhenPausedMs = 0;
  state.totalDurationMs = 0;
  state.stopAfterCycle = false;
  state.currentOrbScale = 1;
  state.lastMotionDirection = "none";
  state.exportInProgress = false;
  stopTicker();
  audio.stopRain();
  clearFeedback();
  renderIdleView();
  setDownloadStatus("", false);
  setDownloadProgress(0, false);
  updateButtons();
}

function updateButtons() {
  const running = state.runState === "running";
  const paused = state.runState === "paused";
  const idleLike = state.runState === "idle" || state.runState === "finished";
  const active = isSessionActive();

  elements.startButton.disabled = !idleLike;
  elements.pauseButton.disabled = !running;
  elements.resumeButton.disabled = !paused;
  elements.stopButton.disabled = idleLike;
  elements.downloadMixButton.disabled = state.exportInProgress;
  elements.toggleSettingsButton.disabled = active;
  setSettingsLocked(active);
  syncLayoutMode(active);
}

function setSettingsLocked(locked) {
  const inputs = elements.form.querySelectorAll("input");
  for (const input of inputs) {
    input.disabled = locked;
  }
}

function isSessionActive() {
  return state.runState === "running" || state.runState === "paused";
}

function syncLayoutMode(active) {
  elements.appRoot.classList.toggle("mode-session", active);
  elements.appRoot.classList.toggle("mode-setup", !active);
  if (active) {
    setSettingsCollapsed(true);
    return;
  }
  setSettingsCollapsed(state.setupSettingsCollapsed);
}

function setSettingsCollapsed(collapsed) {
  elements.controlsPanel.classList.toggle("settings-collapsed", collapsed);
  elements.settingsBody.setAttribute("aria-hidden", collapsed ? "true" : "false");
  elements.toggleSettingsButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
  elements.toggleSettingsButton.textContent = collapsed ? "展开参数" : "收起参数";
}

function updateSettingsSummary() {
  const inhale = parseInteger(elements.inhale.value);
  const hold1 = parseInteger(elements.hold1.value);
  const exhale = parseInteger(elements.exhale.value);
  const hold2 = parseInteger(elements.hold2.value);
  const totalMinutes = parseInteger(elements.totalMinutes.value);
  const volume = parseInteger(elements.volume.value);

  const formatPart = (value, minValue = 0) => (
    Number.isInteger(value) && value >= minValue ? String(value) : "--"
  );
  const rhythm = `${formatPart(inhale, 1)}-${formatPart(hold1)}-${formatPart(exhale, 1)}-${formatPart(hold2)}`;
  const minuteText = `${formatPart(totalMinutes, 1)} 分钟`;
  const volumeText = `${formatPart(volume, 0)}%`;
  const muteText = elements.mute.checked ? " · 静音" : "";

  elements.rhythmSummary.textContent = `当前节奏 ${rhythm} · ${minuteText}`;
  elements.settingsSummary.textContent = `当前参数：${rhythm} · ${minuteText} · 音量 ${volumeText}${muteText}`;
}

function focusSessionPanel() {
  if (!elements.sessionPanel) {
    return;
  }
  window.setTimeout(() => {
    elements.sessionPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

function getElapsedMs(nowMs) {
  if (state.runState === "paused") {
    return state.elapsedWhenPausedMs;
  }
  return nowMs - state.sessionStartMs - state.totalPausedMs;
}

function setDownloadStatus(message, isError = false) {
  elements.downloadStatus.textContent = message;
  elements.downloadStatus.classList.toggle("error", isError);
}

function setDownloadProgress(value, visible = true) {
  const safeValue = clamp(Math.round(value), 0, 100);
  elements.downloadProgress.value = safeValue;
  elements.downloadProgress.classList.toggle("is-active", visible);
  elements.downloadProgress.parentElement.setAttribute("aria-hidden", visible ? "false" : "true");
}

async function handleDownloadMix() {
  if (state.exportInProgress) {
    return;
  }

  const parsed = parseAndValidateSettings();
  if (!parsed.ok) {
    setFeedback(parsed.message, true);
    return;
  }

  state.exportInProgress = true;
  updateButtons();
  setDownloadStatus("正在准备导出...");
  setDownloadProgress(5, true);

  try {
    const timeline = buildSessionTimeline(parsed.settings);
    setDownloadProgress(12, true);
    const audioBuffer = await renderFullSessionAudio(parsed.settings, timeline, setDownloadProgress);
    setDownloadProgress(96, true);
    const wavBlob = audioBufferToWavBlob(audioBuffer);
    const fileName = `${parsed.settings.inhaleSeconds}${parsed.settings.hold1Seconds}${parsed.settings.exhaleSeconds}${parsed.settings.hold2Seconds}breath.wav`;
    triggerDownload(
      wavBlob,
      fileName
    );
    setDownloadProgress(100, true);
    setDownloadStatus("导出完成，已触发下载。");
  } catch (error) {
    setDownloadStatus("导出失败，请用本地 HTTP 服务打开页面后重试。", true);
    setDownloadProgress(0, false);
  } finally {
    state.exportInProgress = false;
    updateButtons();
  }
}

function buildSessionTimeline(settings) {
  const totalTargetSec = settings.totalMinutes * 60;
  const phaseDurations = PHASES.map((phase) => ({
    type: phase.type,
    durationSec: Math.max(0, settings[phase.durationKey])
  }));

  const events = [];
  let elapsedSec = 0;
  let stopAfterCycle = false;
  let guard = 0;

  while (guard < 5000) {
    for (let index = 0; index < phaseDurations.length; index += 1) {
      if (stopAfterCycle && index === 0 && elapsedSec > 0) {
        return { events, totalDurationSec: elapsedSec };
      }
      const phase = phaseDurations[index];
      if (phase.durationSec <= 0) {
        continue;
      }
      events.push({ timeSec: elapsedSec, type: phase.type, durationSec: phase.durationSec });
      elapsedSec += phase.durationSec;
      if (elapsedSec >= totalTargetSec) {
        stopAfterCycle = true;
      }
    }
    guard += 1;
  }

  return { events, totalDurationSec: Math.max(totalTargetSec, elapsedSec) };
}

async function renderFullSessionAudio(settings, timeline, onProgress) {
  const sampleRate = 44100;
  const totalFrames = Math.max(1, Math.ceil(timeline.totalDurationSec * sampleRate));
  const offline = new OfflineAudioContext(2, totalFrames, sampleRate);
  const masterGain = offline.createGain();
  masterGain.gain.value = clamp(settings.volume / 100, 0, 1);
  masterGain.connect(offline.destination);

  onProgress(20, true);
  const exhaleBuffer = await loadExhaleBufferForOffline(offline);

  onProgress(44, true);
  scheduleRainTrack(offline, masterGain, timeline.totalDurationSec, 0.22);

  for (const event of timeline.events) {
    if (event.type === "inhale") {
      scheduleHoldDropOffline(offline, masterGain, event.timeSec);
      continue;
    }
    if (event.type === "hold") {
      scheduleInhaleLowDrumOffline(offline, masterGain, event.timeSec);
      continue;
    }
    if (event.type === "exhale") {
      if (exhaleBuffer) {
        scheduleSampleOffline(
          offline,
          masterGain,
          exhaleBuffer,
          event.timeSec,
          0.95,
          event.durationSec
        );
      } else {
        scheduleExhaleFallbackOffline(
          offline,
          masterGain,
          event.timeSec,
          event.durationSec
        );
      }
    }
  }

  let progressValue = 52;
  onProgress(progressValue, true);
  const estimateMs = Math.max(1400, Math.round(timeline.totalDurationSec * 90));
  const startedAt = performance.now();
  const progressTimer = window.setInterval(() => {
    const elapsed = performance.now() - startedAt;
    const ratio = clamp(elapsed / estimateMs, 0, 1);
    progressValue = 52 + Math.round(ratio * 42);
    onProgress(progressValue, true);
  }, 130);

  try {
    const rendered = await offline.startRendering();
    return rendered;
  } finally {
    window.clearInterval(progressTimer);
  }
}

async function loadBufferForOffline(audioContext, path) {
  try {
    const data = await fetchArrayBuffer(path);
    return await audioContext.decodeAudioData(data);
  } catch (error) {
    return null;
  }
}

async function loadExhaleBufferForOffline(audioContext) {
  const direct = await loadBufferForOffline(audioContext, SAMPLE_FILES.exhale);
  if (direct) {
    return direct;
  }
  const embeddedUrl = typeof window !== "undefined" ? window.EXHALE_EMBEDDED_DATA_URL : null;
  if (embeddedUrl && typeof embeddedUrl === "string") {
    const embedded = await loadBufferFromDataUrl(audioContext, embeddedUrl);
    if (embedded) {
      return embedded;
    }
  }
  try {
    const absolute = new URL(SAMPLE_FILES.exhale, window.location.href).href;
    return await loadBufferForOffline(audioContext, absolute);
  } catch (error) {
    return null;
  }
}

async function loadBufferFromDataUrl(audioContext, dataUrl) {
  try {
    const raw = decodeBase64DataUrl(dataUrl);
    return await audioContext.decodeAudioData(raw);
  } catch (error) {
    return null;
  }
}

function scheduleRainTrack(audioContext, destination, totalDurationSec, gainLevel = 0.22) {
  if (totalDurationSec <= 0) {
    return;
  }

  const buffer = createRainNoiseBuffer(audioContext, 2.4);
  const source = audioContext.createBufferSource();
  const highpass = audioContext.createBiquadFilter();
  const lowpass = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  const flutter = audioContext.createOscillator();
  const flutterGain = audioContext.createGain();

  source.buffer = buffer;
  source.loop = true;
  highpass.type = "highpass";
  highpass.frequency.value = 900;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 6200;
  gain.gain.value = gainLevel;
  flutter.type = "sine";
  flutter.frequency.value = 0.24;
  flutterGain.gain.value = gainLevel * 0.18;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(destination);
  flutter.connect(flutterGain);
  flutterGain.connect(gain.gain);

  source.start(0.0);
  flutter.start(0.0);
  source.stop(totalDurationSec);
  flutter.stop(totalDurationSec);
}

function scheduleSampleOffline(
  audioContext,
  destination,
  buffer,
  atSec,
  gainValue = 1,
  maxDurationSec = null
) {
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  gain.gain.value = gainValue;
  source.connect(gain);
  gain.connect(destination);
  source.start(atSec);
  if (Number.isFinite(maxDurationSec) && maxDurationSec > 0) {
    const stopAt = atSec + maxDurationSec;
    source.stop(stopAt);
  }
}

function scheduleExhaleFallbackOffline(audioContext, destination, atSec, durationSec = 1.8) {
  const safeDuration = clamp(durationSec || 1.8, 0.4, 20);
  const attack = Math.min(0.2, safeDuration * 0.22);
  const releaseAt = atSec + safeDuration;

  const tone = audioContext.createOscillator();
  const shimmer = audioContext.createOscillator();
  const toneGain = audioContext.createGain();
  const shimmerGain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const mix = audioContext.createGain();

  tone.type = "sine";
  shimmer.type = "triangle";
  tone.frequency.setValueAtTime(620, atSec);
  tone.frequency.exponentialRampToValueAtTime(430, releaseAt);
  shimmer.frequency.setValueAtTime(940, atSec);
  shimmer.frequency.exponentialRampToValueAtTime(620, releaseAt);

  toneGain.gain.setValueAtTime(0.0001, atSec);
  toneGain.gain.linearRampToValueAtTime(0.2, atSec + attack);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);

  shimmerGain.gain.setValueAtTime(0.0001, atSec);
  shimmerGain.gain.linearRampToValueAtTime(0.08, atSec + attack * 0.85);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);

  filter.type = "lowpass";
  filter.frequency.value = 2200;
  filter.Q.value = 0.8;
  mix.gain.value = 0.92;

  tone.connect(toneGain);
  shimmer.connect(shimmerGain);
  toneGain.connect(mix);
  shimmerGain.connect(mix);
  mix.connect(filter);
  filter.connect(destination);

  tone.start(atSec);
  shimmer.start(atSec);
  tone.stop(releaseAt + 0.03);
  shimmer.stop(releaseAt + 0.03);
}

function scheduleHoldDropOffline(audioContext, destination, atSec) {
  const drop = audioContext.createOscillator();
  const tail = audioContext.createOscillator();
  const dropGain = audioContext.createGain();
  const tailGain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const mix = audioContext.createGain();

  drop.type = "sine";
  tail.type = "triangle";
  drop.frequency.setValueAtTime(980, atSec);
  drop.frequency.exponentialRampToValueAtTime(410, atSec + 0.2);
  tail.frequency.setValueAtTime(560, atSec + 0.02);
  tail.frequency.exponentialRampToValueAtTime(300, atSec + 1.0);

  dropGain.gain.setValueAtTime(0.0001, atSec);
  dropGain.gain.linearRampToValueAtTime(0.3, atSec + 0.01);
  dropGain.gain.exponentialRampToValueAtTime(0.0001, atSec + 0.32);

  tailGain.gain.setValueAtTime(0.0001, atSec);
  tailGain.gain.linearRampToValueAtTime(0.13, atSec + 0.04);
  tailGain.gain.exponentialRampToValueAtTime(0.0001, atSec + 1.05);

  filter.type = "bandpass";
  filter.frequency.value = 1050;
  filter.Q.value = 7.5;

  drop.connect(filter);
  filter.connect(dropGain);
  tail.connect(tailGain);
  dropGain.connect(mix);
  tailGain.connect(mix);
  mix.connect(destination);

  drop.start(atSec);
  tail.start(atSec);
  drop.stop(atSec + 0.34);
  tail.stop(atSec + 1.08);
}

function scheduleInhaleLowDrumOffline(audioContext, destination, atSec) {
  const strike = audioContext.createOscillator();
  const resonance = audioContext.createOscillator();
  const strikeGain = audioContext.createGain();
  const resonanceGain = audioContext.createGain();
  const tone = audioContext.createBiquadFilter();
  const mix = audioContext.createGain();

  strike.type = "triangle";
  resonance.type = "sine";
  strike.frequency.setValueAtTime(190, atSec);
  strike.frequency.exponentialRampToValueAtTime(82, atSec + 0.2);
  resonance.frequency.setValueAtTime(120, atSec + 0.02);
  resonance.frequency.exponentialRampToValueAtTime(68, atSec + 1.0);

  strikeGain.gain.setValueAtTime(0.0001, atSec);
  strikeGain.gain.linearRampToValueAtTime(0.3, atSec + 0.01);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, atSec + 0.32);

  resonanceGain.gain.setValueAtTime(0.0001, atSec);
  resonanceGain.gain.linearRampToValueAtTime(0.13, atSec + 0.04);
  resonanceGain.gain.exponentialRampToValueAtTime(0.0001, atSec + 1.05);

  tone.type = "lowpass";
  tone.frequency.value = 340;
  tone.Q.value = 1.05;

  strike.connect(strikeGain);
  resonance.connect(resonanceGain);
  strikeGain.connect(mix);
  resonanceGain.connect(mix);
  mix.connect(tone);
  tone.connect(destination);

  strike.start(atSec);
  resonance.start(atSec);
  strike.stop(atSec + 0.34);
  resonance.stop(atSec + 1.08);
}

function audioBufferToWavBlob(audioBuffer) {
  const wavBytes = encodeWavFromBuffer(audioBuffer);
  return new Blob([wavBytes], { type: "audio/wav" });
}

function encodeWavFromBuffer(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channels = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(audioBuffer.getChannelData(channel));
  }
  for (let index = 0; index < frameCount; index += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = clamp(channels[channel][index], -1, 1);
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }
  return buffer;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function decodeBase64DataUrl(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const binary = window.atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function fetchArrayBuffer(path) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", path, true);
    request.responseType = "arraybuffer";
    request.onload = () => {
      const status = request.status;
      if ((status >= 200 && status < 300) || status === 0) {
        resolve(request.response);
        return;
      }
      reject(new Error(`Request failed: ${status}`));
    };
    request.onerror = () => reject(new Error("Network error"));
    request.send();
  });
}

function triggerDownload(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function parseAndValidateSettings() {
  const settings = {
    inhaleSeconds: parseInteger(elements.inhale.value),
    hold1Seconds: parseInteger(elements.hold1.value),
    exhaleSeconds: parseInteger(elements.exhale.value),
    hold2Seconds: parseInteger(elements.hold2.value),
    totalMinutes: parseInteger(elements.totalMinutes.value),
    volume: parseInteger(elements.volume.value),
    mute: elements.mute.checked
  };

  if (!Number.isInteger(settings.inhaleSeconds) || settings.inhaleSeconds < 1) {
    return { ok: false, message: "吸气时长必须是不小于 1 的整数秒。" };
  }
  if (!Number.isInteger(settings.exhaleSeconds) || settings.exhaleSeconds < 1) {
    return { ok: false, message: "呼气时长必须是不小于 1 的整数秒。" };
  }
  if (!Number.isInteger(settings.hold1Seconds) || settings.hold1Seconds < 0) {
    return { ok: false, message: "暂停1时长必须是不小于 0 的整数秒。" };
  }
  if (!Number.isInteger(settings.hold2Seconds) || settings.hold2Seconds < 0) {
    return { ok: false, message: "暂停2时长必须是不小于 0 的整数秒。" };
  }
  if (!Number.isInteger(settings.totalMinutes) || settings.totalMinutes < 1) {
    return { ok: false, message: "总时长必须是不小于 1 的整数分钟。" };
  }
  if (!Number.isInteger(settings.volume) || settings.volume < 0 || settings.volume > 100) {
    return { ok: false, message: "音量范围应为 0 到 100。" };
  }

  return { ok: true, settings };
}

function saveSettings() {
  const payload = {
    inhaleSeconds: parseInteger(elements.inhale.value),
    hold1Seconds: parseInteger(elements.hold1.value),
    exhaleSeconds: parseInteger(elements.exhale.value),
    hold2Seconds: parseInteger(elements.hold2.value),
    totalMinutes: parseInteger(elements.totalMinutes.value),
    volume: parseInteger(elements.volume.value),
    mute: elements.mute.checked
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    return;
  }
}

function loadSettings() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    stored = null;
  }
  if (!stored) {
    audio.setVolume(Number(elements.volume.value) / 100);
    audio.setMuted(elements.mute.checked);
    return;
  }

  try {
    const parsed = JSON.parse(stored);
    setIfValid(elements.inhale, parsed.inhaleSeconds, 1);
    setIfValid(elements.hold1, parsed.hold1Seconds, 0);
    setIfValid(elements.exhale, parsed.exhaleSeconds, 1);
    setIfValid(elements.hold2, parsed.hold2Seconds, 0);
    setIfValid(elements.totalMinutes, parsed.totalMinutes, 1);
    setIfValid(elements.volume, parsed.volume, 0, 100);
    elements.mute.checked = Boolean(parsed.mute);
  } catch (error) {
    return;
  }

  audio.setVolume(Number(elements.volume.value) / 100);
  audio.setMuted(elements.mute.checked);
}

function setIfValid(input, value, min, max = Number.POSITIVE_INFINITY) {
  if (!Number.isInteger(value)) {
    return;
  }
  if (value < min || value > max) {
    return;
  }
  input.value = String(value);
}

function setFeedback(message, isError = false) {
  elements.feedback.textContent = message;
  elements.feedback.classList.toggle("error", isError);
}

function clearFeedback() {
  setFeedback("");
}

function parseInteger(rawValue) {
  return Number.parseInt(rawValue, 10);
}

function formatMs(ms) {
  const seconds = Math.ceil(ms / 1000);
  const safeSeconds = Math.max(seconds, 0);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
