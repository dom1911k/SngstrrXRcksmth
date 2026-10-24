export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.launcher {
  position: fixed; right: 0; top: 38%; z-index: 2147483000;
  writing-mode: vertical-rl; transform: rotate(180deg);
  background: #15171c; color: #f2c418; border: 1px solid #333; border-left: none;
  border-radius: 0 8px 8px 0; padding: 14px 7px; cursor: pointer;
  font: 600 13px/1 system-ui, sans-serif; letter-spacing: .06em;
  box-shadow: 0 2px 12px rgba(0,0,0,.4);
}
.launcher:hover { color: #fff; }
.launcher-dot { display: inline-block; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: #e8202a; }
.launcher-dot[hidden] { display: none; }
.update { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 14px; background: #2b2410; color: #f2c418; border-bottom: 1px solid #4a3d12; }
.update.done { background: #10291a; color: #5fd38d; border-color: #1d4a2e; }
.update[hidden] { display: none; }
.panel {
  position: fixed; right: 12px; top: 72px; z-index: 2147483001;
  width: 360px; max-height: calc(100vh - 190px); overflow-y: auto;
  background: #15171c; color: #e8e8ea; border: 1px solid #2c2f36; border-radius: 10px;
  font: 13px/1.45 system-ui, -apple-system, Segoe UI, sans-serif;
  box-shadow: 0 8px 30px rgba(0,0,0,.5);
}
.panel[hidden] { display: none; }
header { display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid #2c2f36; position: sticky; top: 0; background: #15171c; z-index: 1; }
header h1 { margin: 0; font-size: 15px; font-weight: 700; color: #f2c418; }
.close { background: none; border: none; color: #aaa; font-size: 20px; cursor: pointer; line-height: 1; }
section { padding: 12px 14px; border-bottom: 1px solid #23262c; }
section:last-child { border-bottom: none; }
h2.fold { cursor: pointer; user-select: none; }
h2.fold::after { content: ' ▾'; color: #5f6673; }
section.collapsed > *:not(h2:first-child) { display: none; }
section.collapsed > h2:first-child { margin-bottom: 0; }
section.collapsed > h2:first-child::after { content: ' ▸'; }
h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9aa0aa; }
button.btn { background: #2a2e36; color: #fff; border: 1px solid #3a3f49; border-radius: 6px;
  padding: 6px 12px; font: inherit; cursor: pointer; }
button.btn:hover { background: #343944; }
button.btn.primary { background: #e8202a; border-color: #e8202a; }
button.btn.primary:hover { background: #ff3a43; }
button.btn:disabled { opacity: .5; cursor: default; }
select, input[type=number] { background: #0e1014; color: #e8e8ea; border: 1px solid #3a3f49;
  border-radius: 6px; padding: 5px 6px; font: inherit; max-width: 100%; }
.row { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
label.row { flex-wrap: nowrap; align-items: flex-start; }
.grow { flex: 1; min-width: 0; }
.muted { color: #8b919c; font-size: 12px; }
.warn { color: #ffb347; }
.bad { color: #ff5a5f; }
.good { color: #5fd38d; }
.meter { position: relative; height: 10px; background: #0e1014; border-radius: 5px; overflow: hidden; border: 1px solid #2c2f36; }
.meter .fill { position: absolute; inset: 0 auto 0 0; width: 0; background: linear-gradient(90deg, #3dbb4a, #f2c418 75%, #e8202a); }
.meter .peak { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; left: 0; }
.tuner-note { font-size: 54px; font-weight: 800; text-align: center; line-height: 1.1; margin-top: 4px; font-variant-numeric: tabular-nums; }
.tuner-note small { font-size: 18px; color: #8b919c; font-weight: 600; margin-left: 4px; }
.tuner-cents { text-align: center; font-size: 13px; color: #8b919c; height: 18px; font-variant-numeric: tabular-nums; }
.needle-scale { position: relative; height: 26px; margin: 6px 4px; border-bottom: 1px solid #3a3f49; }
.needle-scale .tick { position: absolute; bottom: 0; width: 1px; height: 8px; background: #3a3f49; }
.needle-scale .tick.center { height: 26px; background: #5fd38d; }
.needle-scale .zone { position: absolute; top: 0; bottom: 0; background: rgba(95,211,141,.15); }
.needle { position: absolute; bottom: 0; width: 4px; height: 24px; margin-left: -2px; border-radius: 2px; background: #fff; transition: left 60ms linear; }
.strings { display: flex; gap: 6px; justify-content: center; margin-top: 8px; }
.string { flex: 1; text-align: center; padding: 6px 0 4px; border-radius: 6px; border: 2px solid transparent;
  background: #0e1014; font-weight: 700; }
.string .c { display: block; font-size: 11px; font-weight: 500; color: #8b919c; height: 15px; }
.string.active { background: #222630; }
input[type=range] { width: 100%; accent-color: #f2c418; }
.dots { display: flex; gap: 4px; flex-wrap: wrap; margin: 8px 0; }
.dot { width: 14px; height: 14px; border-radius: 50%; background: #2a2e36; }
.dot.now { background: #f2c418; }
.dot.done { background: #5f6673; }
.big { font-size: 22px; font-weight: 700; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 12px; }
.kv span:nth-child(odd) { color: #8b919c; }
ol { margin: 4px 0 8px 18px; padding: 0; }
.sc { margin: 3px 0; font-size: 12px; flex-wrap: nowrap; }
.sc .keys { display: flex; gap: 3px; flex-wrap: wrap; justify-content: flex-end; }
.sub { margin: 10px 0 4px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8b93a3; }
.detlist { max-height: 170px; overflow: auto; }
kbd { background: #0e1014; border: 1px solid #3a3f49; border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; font: 11px/1.6 system-ui; color: #e8e8ea; }
button.btn.small { padding: 2px 7px; font-size: 11px; }
`;
