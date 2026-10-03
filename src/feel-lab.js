/* Hidden, opt-in developer panel. ?feelLab=1 enables it for this tab only.
 * Deliberately client-local: no settings persistence or network messages.
 * This is a tuning instrument, not a privileged security surface.
 */
'use strict';
const FeelLab = (() => {
  const enabled = new URLSearchParams(location.search).get('feelLab') === '1';
  const groups = [
    ['Clean strike', [
      ['minNormalSpeed', 'Relative speed', 700, 1700, 50],
      ['minMalletDrive', 'Forward drive', 450, 1200, 50],
      ['minDriveAlignment', 'Drive alignment', 0.55, 0.95, 0.01],
      ['maxGlanceRatio', 'Glance tolerance', 0.2, 0.9, 0.02],
      ['perfectCrackGain', 'Crack loudness', 0.12, 0.36, 0.01],
      ['perfectFlashEnergy', 'Flash strength', 0.06, 0.22, 0.01],
      ['perfectHapticMs', 'Haptic (ms)', 0, 12, 1],
    ]],
    ['Rally tension', [
      ['minReturnDistance', 'Return distance', 95, 290, 5],
      ['minReturnGapMs', 'Return interval (ms)', 80, 260, 10],
      ['rallyStart', 'Tension onset', 2, 6, 1],
      ['rallySpan', 'Build-up length', 5, 15, 1],
      ['rallyTrailLift', 'Trail lift', 0, 0.35, 0.01],
      ['rallyMusicLift', 'Music lift', 0, 0.06, 0.005],
      ['rallyPitchLift', 'Strike brightness', 0, 0.15, 0.01],
    ]],
    ['Goal release', [
      ['goalReleaseCap', 'Long-rally bonus', 0, 0.15, 0.01],
    ]],
  ];
  const stats = { hits:0, perfect:0, rally:0, goals:0, lastImpact:0, lastGoalRally:0 };
  let host = null, panel = null, status = null, presetBox = null, note = null;
  const format = n => Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
  const element = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  function refreshStatus() {
    if (!status || !panel || panel.hidden) return;
    status.textContent = 'Hits ' + stats.hits + ' / clean ' + stats.perfect +
      '  ·  rally ' + stats.rally + '  ·  goals ' + stats.goals +
      '\nLast impact ' + Math.round(stats.lastImpact) +
      '  ·  goal rally ' + stats.lastGoalRally;
  }
  function refreshMusic() {
    // The music and ambience buses are local. Force a fresh calculation only
    // while tuning, so moving a slider is audible before the next return.
    if (typeof G !== 'undefined' && typeof MusicSys !== 'undefined' && G.stats)
      MusicSys.setRally(Feel.rallyIntensity(G.stats.rally), true);
  }
  function syncSliders() {
    if (!panel) return;
    panel.querySelectorAll('input[data-feel]').forEach(input => {
      input.value = String(Feel.tuning[input.dataset.feel]);
      input.nextSibling.textContent = format(Feel.tuning[input.dataset.feel]);
    });
    refreshMusic();
  }
  function mount() {
    if (!enabled || host || !document.body) return;
    const css = document.createElement('style');
    css.id = 'atelierFeelLabStyle';
    css.textContent = [
      '#atelierFeelLab{position:fixed;left:max(10px,env(safe-area-inset-left));bottom:max(10px,env(safe-area-inset-bottom));z-index:110;',
      'font:12px/1.35 system-ui,sans-serif;color:#f0ebdf;pointer-events:auto;touch-action:pan-y}',
      '#atelierFeelLab *{box-sizing:border-box}',
      '#atelierFeelLab button{border:1px solid #877357;border-radius:8px;background:#272420;color:#f0ebdf;padding:7px 11px;cursor:pointer;font:inherit}',
      '#atelierFeelLab button:focus-visible,#atelierFeelLab input:focus-visible,#atelierFeelLab textarea:focus-visible{outline:2px solid #f0c870;outline-offset:2px}',
      '#atelierFeelLab .fl-panel{width:min(320px,calc(100vw - 24px));max-height:min(68dvh,540px);overflow-y:auto;overscroll-behavior:contain;',
      'background:#191714ee;border:1px solid #877357;border-radius:12px;padding:12px;margin-bottom:8px;box-shadow:0 8px 28px #0009}',
      '#atelierFeelLab h2{font-size:14px;font-weight:700;margin:0 0 5px}',
      '#atelierFeelLab p{font-size:11px;color:#c3b7a4;margin:0 0 9px}',
      '#atelierFeelLab details{border-top:1px solid #625641;padding:6px 0}',
      '#atelierFeelLab summary{font-weight:600;cursor:pointer;padding:5px 0}',
      '#atelierFeelLab label{display:grid;grid-template-columns:1fr 1fr 40px;align-items:center;gap:7px;margin:7px 0}',
      '#atelierFeelLab input[type=range]{width:100%;accent-color:#e2b760;touch-action:auto}',
      '#atelierFeelLab output{text-align:right;font-variant-numeric:tabular-nums}',
      '#atelierFeelLab .fl-row{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0}',
      '#atelierFeelLab pre{white-space:pre-wrap;font:11px/1.5 ui-monospace,monospace;color:#d4c9b8;margin:5px 0}',
      '#atelierFeelLab textarea{width:100%;min-height:55px;resize:vertical;background:#24201b;color:#eee; border:1px solid #877357;padding:5px;border-radius:5px}',
      '#atelierFeelLab .fl-note{min-height:1.2em}',
    ].join('');
    document.head.appendChild(css);
    host = element('aside');
    host.id = 'atelierFeelLab';
    const toggle = element('button', 'FEEL LAB', 'fl-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'atelierFeelLabPanel');
    panel = element('section', '', 'fl-panel');
    panel.id = 'atelierFeelLabPanel';
    panel.hidden = true;
    panel.appendChild(element('h2', 'Live Feel Lab'));
    panel.appendChild(element('p', 'This tab only. Audio, visual and classification tuning; no gameplay power changes.'));
    status = element('pre', '', 'fl-status');
    panel.appendChild(status);
    for (const [section, sliders] of groups) {
      const details = element('details');
      details.appendChild(element('summary', section));
      for (const [key, title, low, high, step] of sliders) {
        const label = element('label');
        label.appendChild(element('span', title));
        const slider = element('input');
        slider.type = 'range';
        slider.dataset.feel = key;
        slider.min = String(low); slider.max = String(high); slider.step = String(step);
        slider.value = String(Feel.tuning[key]);
        const value = element('output', format(Feel.tuning[key]));
        label.append(slider, value);
        slider.addEventListener('input', () => {
          Feel.tune(key, Number(slider.value));
          value.textContent = format(Feel.tuning[key]);
          refreshMusic();
        });
        details.appendChild(label);
      }
      panel.appendChild(details);
    }
    const buttons = element('div', '', 'fl-row');
    const reset = element('button', 'Reset', '');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      Feel.reset(); syncSliders(); note.textContent = 'Defaults restored';
    });
    const capture = element('button', 'Capture preset', '');
    capture.type = 'button';
    capture.addEventListener('click', () => {
      presetBox.value = JSON.stringify(Feel.preset(), null, 2);
      presetBox.select();
      note.textContent = 'Preset selected; copy it or edit it below';
    });
    const apply = element('button', 'Apply preset', '');
    apply.type = 'button';
    apply.addEventListener('click', () => {
      try {
        if (!Feel.applyPreset(JSON.parse(presetBox.value))) throw new Error('invalid fields');
        syncSliders(); note.textContent = 'Preset applied to this tab';
      } catch (_) { note.textContent = 'Invalid preset. Use numeric known fields only.'; }
    });
    buttons.append(reset, capture, apply);
    panel.appendChild(buttons);
    presetBox = element('textarea');
    presetBox.setAttribute('aria-label', 'Feel Lab JSON preset');
    presetBox.placeholder = 'Capture or paste a tuning preset';
    panel.appendChild(presetBox);
    note = element('p', '', 'fl-note');
    note.setAttribute('role', 'status');
    panel.appendChild(note);
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) { syncSliders(); refreshStatus(); }
    });
    // Prevent sliders/panel gestures from simultaneously controlling mallets.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend'])
      host.addEventListener(type, ev => ev.stopPropagation());
    host.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && !panel.hidden) {
        panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus();
      }
      ev.stopPropagation();
    });
    host.append(panel, toggle);
    document.body.appendChild(host);
  }
  return {
    enabled, mount,
    recordHit(event) {
      if (!enabled || !event) return;
      stats.hits++;
      if (event.perfect) stats.perfect++;
      stats.lastImpact = event.impact || 0;
      refreshStatus();
    },
    recordRally(count) {
      if (!enabled) return;
      stats.rally = count;
      refreshStatus();
    },
    recordGoal(rally) {
      if (!enabled) return;
      stats.goals++; stats.lastGoalRally = rally;
      stats.rally = 0; refreshStatus();
    },
  };
})();
if (FeelLab.enabled) FeelLab.mount();
