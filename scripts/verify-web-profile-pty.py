"""Keyless PTY smoke: ignore stale TUI preferences and follow a live Web edit."""
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import fcntl
import time

root = Path(__file__).resolve().parent.parent
source = Path(os.environ.get('DSH_WEB_PROFILE_SOURCE', str(Path.home() / '.dsh/profiles/web')))
scratch = Path(tempfile.mkdtemp(prefix='dsh-web-tui-pty-'))
profile = scratch / 'home/profiles/web'
process = None
master = None
transcript = bytearray()
try:
    profile.mkdir(parents=True)
    shutil.copy(source / 'package.json', profile / 'package.json')
    shutil.copytree(source / 'node_modules', profile / 'node_modules', symlinks=True)
    original = (source / 'cordis.patch.yml').read_text()
    (profile / 'cordis.patch.yml').write_text(original)
    prefs = scratch / '.dsh-tui'
    prefs.mkdir()
    for name, value in {
        'model.json': {'provider': 'openai-codex', 'model': 'gpt-6.1-sol'},
        'effort.json': {'effort': 'medium'},
        'agent-preset.json': {'preset': 'standard'},
        'home.json': {'seen': True},
        'settings.json': {'launchpad': False, 'effortDefault': 'medium'},
    }.items():
        (prefs / name).write_text(json.dumps(value))
    probe = scratch / 'probe.mjs'
    report = scratch / 'agents.json'
    probe.write_text('''
import { writeFileSync } from 'node:fs';
export const name = 'pty-probe';
export const inject = ['agents', 'agentDefaultModel', 'appReady'];
export function apply(ctx) {
  ctx.appReady.onReady(() => {
    const timer = setInterval(() => writeFileSync(process.env.PTY_REPORT, JSON.stringify({
      default: ctx.agentDefaultModel.currentSelection(),
      agents: ctx.agents.list().map(a => ({id: a.id, options: a.options, header: a.session.header}))
    })), 100);
    ctx.effect(() => () => clearInterval(timer));
  });
}
''')
    overlay = scratch / 'probe.patch.yml'
    overlay.write_text('- insert:\n    - id: pty-probe\n      name: ' + json.dumps(str(probe)) + '\n')
    preload = scratch / 'no-network.mjs'
    preload.write_text("globalThis.fetch = async () => { throw new Error('Network disabled in fixture'); };\n")
    env = dict(os.environ, HOME=str(scratch), DSH_HOME=str(scratch / 'home'),
               PTY_REPORT=str(report), DSH_TUI_LANG='en', TERM='xterm-256color',
               NODE_OPTIONS='--import=' + str(preload), DSH_TELEMETRY_DISABLED='1')
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
    process = subprocess.Popen(['sh', str(root / 'bin/dsh-tui-web'), '--patch', str(overlay)],
                               cwd=scratch, env=env, stdin=slave, stdout=slave, stderr=slave,
                               start_new_session=True)
    os.close(slave)
    def wait_for(predicate, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    transcript.extend(os.read(master, 65536))
                except OSError:
                    pass
            if process.poll() is not None:
                raise AssertionError('TUI exited: ' + transcript.decode(errors='replace')[-12000:])
            try:
                value = json.loads(report.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                continue
            if predicate(value):
                return value
        raise AssertionError('TUI timeout: ' + transcript.decode(errors='replace')[-12000:])
    initial = wait_for(lambda value: bool(value['agents']))
    first = initial['agents'][-1]
    assert first['options']['provider'] == 'h200-anthropic', first
    assert first['options']['model'] == 'DeepSeek-V4.1-Flash-1017-H200', first
    assert 'pi-compatible' in json.dumps(first['header']), first
    print('PTY startup: Web H200 model and Pi-compatible preset beat stale TUI preferences')
    (profile / 'cordis.patch.yml').write_text(original + '\n- id: agent-default-model\n  config: {provider: openai-codex, model: gpt-6.1-sol, reasoningEffort: high}\n- id: agent-preset-registry\n  config: {default: minimal, selectedDefault: minimal}\n')
    wait_for(lambda value: value['default']['provider'] == 'openai-codex')
    # Separate typing and Enter: a single chunk is intentionally treated as
    # pasted text by the terminal input parser, not a submit keystroke.
    before_input = len(transcript)
    os.write(master, b'/new')
    wait_for(lambda _: b'/new' in transcript[before_input:])
    os.write(master, b'\r')
    updated = wait_for(lambda value: any(a['id'] != first['id'] for a in value['agents']))
    current = next(a for a in updated['agents'] if a['id'] != first['id'])
    assert current['options']['provider'] == 'openai-codex', current
    assert current['options']['model'] == 'gpt-6.1-sol', current
    assert 'minimal' in json.dumps(current['header']), current
    print('PTY /new: adopted live Web model and preset changes without restarting')
finally:
    if process is not None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    if master is not None:
        os.close(master)
    shutil.rmtree(scratch)
