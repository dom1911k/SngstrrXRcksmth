// Lessons in the standalone player: a dialog with the course list and one
// lesson's explanation and steps, and a bar under the header while a step is
// running ("Step 1/3: … reach 85%"). A step is passed when a full run of its
// drill at 100% speed reaches the target accuracy.
import { h } from './dom.js';
import { LESSONS, lessonById, lessonState, passesStep, recordStep, stepCount, loadLessonProgress, saveLessonProgress } from '../core/lessons.js';
import { drillById } from '../core/drills.js';

const pct = (x) => `${Math.round(x * 100)}%`;

export function createLessonsUI({ session, adapter, startDrill, notify = () => {}, mount = document.body, barMount = document.body }) {
  let progress = {};
  let current = null;     // { lesson, step }
  let selected = LESSONS[0];

  const list = h('div', { class: 'lesson-list' });
  const detail = h('div', { class: 'lesson-detail' });
  const dialog = h('div', { class: 'dialog', id: 'lessons', hidden: true },
    h('div', { class: 'dialog-box wide' },
      h('h2', {}, 'Lessons'),
      h('p', { class: 'small' }, 'Short courses, one technique each: read the explanation, then pass each step (a drill at full speed with the target accuracy). Start the input in the BASS TRAINER panel first.'),
      h('div', { class: 'lesson-grid' }, list, detail),
      h('div', { class: 'dialog-row' }, h('button', { class: 'btn', onclick: () => close() }, 'Close'))));
  const barText = h('span', { class: 'grow' });
  const nextBtn = h('button', { class: 'btn primary', hidden: true, onclick: () => goNext() }, 'Next step ▶');
  const bar = h('div', { id: 'lessonBar', class: 'lesson-bar', hidden: true },
    h('b', {}, '🎓'), barText, nextBtn,
    h('button', { class: 'btn', onclick: () => open(current && current.lesson) }, 'Lesson'),
    h('button', { class: 'btn', title: 'Leave the lesson', onclick: () => { current = null; renderBar(); } }, '✕'));
  mount.append(dialog);
  barMount.append(bar);

  function renderList() {
    list.replaceChildren(...LESSONS.map((l) => {
      const st = lessonState(l, progress);
      return h('button', { class: `lesson${l === selected ? ' on' : ''}${st.done ? ' done' : ''}`, onclick: () => { selected = l; render(); } },
        h('span', { class: 'lvl' }, l.level), h('b', {}, `${st.done ? '✓ ' : ''}${l.title}`),
        h('span', { class: 'prog' }, h('i', { style: { width: `${Math.round(st.fraction * 100)}%` } })));
    }));
  }

  function renderDetail() {
    const l = selected;
    const st = lessonState(l, progress);
    const stepRow = (i) => {
      const passed = st.passed.has(i);
      if (i === l.steps.length) {
        return h('div', { class: `lstep${passed ? ' passed' : ''}` },
          h('span', { class: 'n' }, passed ? '✓' : String(i + 1)),
          h('div', { class: 'grow' }, h('b', {}, 'Apply it'), h('div', { class: 'small' }, l.apply)),
          h('a', { class: 'btn', href: '../library/library.html', target: '_blank' }, 'Library'),
          passed ? null : h('button', { class: 'btn', onclick: () => mark(l, i) }, 'Done'));
      }
      const s = l.steps[i];
      const best = st.best[i];
      return h('div', { class: `lstep${passed ? ' passed' : ''}${st.next === i ? ' nextup' : ''}` },
        h('span', { class: 'n' }, passed ? '✓' : String(i + 1)),
        h('div', { class: 'grow' }, h('b', {}, s.title),
          h('div', { class: 'small' }, `${drillById(s.drill).name} · reach ${pct(s.target)} at full speed${best !== undefined ? ` · your best ${pct(best)}` : ''}`)),
        h('button', { class: `btn${st.next === i ? ' primary' : ''}`, onclick: () => begin(l, i) }, passed ? 'Again' : 'Start'));
    };
    detail.replaceChildren(
      h('div', { class: 'lvl' }, l.level),
      h('h3', {}, l.title),
      h('p', {}, l.intro),
      h('ul', { class: 'tips' }, ...l.tips.map((t) => h('li', {}, t))),
      ...[...Array(stepCount(l)).keys()].map(stepRow));
  }

  function render() { renderList(); renderDetail(); }

  function renderBar() {
    bar.hidden = !current;
    if (!current) return;
    const { lesson: l, step: i } = current;
    const s = l.steps[i];
    const st = lessonState(l, progress);
    const best = st.best[i];
    barText.textContent = `${l.title} · step ${i + 1}/${stepCount(l)}: ${s.title}. Reach ${pct(s.target)} at full speed${best !== undefined ? ` (best ${pct(best)})` : ''}.`;
    nextBtn.hidden = !st.passed.has(i);
    nextBtn.textContent = i + 1 < l.steps.length ? 'Next step ▶' : 'Finish lesson ▶';
  }

  async function mark(l, i, accuracy = null, passed = true) {
    progress = recordStep(progress, l.id, i, accuracy, passed);
    await saveLessonProgress(progress);
    render();
    renderBar();
  }

  function begin(l, i) {
    current = { lesson: l, step: i };
    const s = l.steps[i];
    close();
    startDrill(s.drill, { ...drillById(s.drill).defaults, bpm: s.bpm, bars: s.bars || drillById(s.drill).defaults.bars, ...(s.position !== undefined ? { position: s.position } : {}) });
    adapter.setSpeed && adapter.setSpeed(100);
    renderBar();
  }

  function goNext() {
    if (!current) return;
    const { lesson: l, step: i } = current;
    if (i + 1 < l.steps.length) begin(l, i + 1);
    else { selected = l; current = null; renderBar(); open(l); }
  }

  session.on('summary', async (sum) => {
    if (!current || sum.kind !== 'song') return;
    const { lesson: l, step: i } = current;
    const chart = adapter.getChart();
    const ok = passesStep(l.steps[i], sum, chart ? chart.notes.length : 0);
    await mark(l, i, sum.accuracy, ok);
    notify(ok ? `🎓 Step passed with ${pct(sum.accuracy)}!` : `${pct(sum.accuracy)} · ${pct(l.steps[i].target)} needed at full speed. Press play to try again.`);
  });

  async function open(l = null) {
    progress = await loadLessonProgress();
    if (l) selected = l;
    else {
      const firstOpen = LESSONS.find((x) => !lessonState(x, progress).done);
      if (firstOpen) selected = firstOpen;
    }
    render();
    dialog.hidden = false;
  }
  function close() { dialog.hidden = true; }

  loadLessonProgress().then((p) => { progress = p; });
  return { open, close, begin: (id, step) => { const l = lessonById(id); if (l) loadLessonProgress().then((p) => { progress = p; begin(l, Math.min(step || 0, l.steps.length - 1)); }); }, get current() { return current; } };
}
