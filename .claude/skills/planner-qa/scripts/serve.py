#!/usr/bin/env python3
"""저장소를 GitHub Pages 처럼 띄운다: /mockup-shell 도 mockup-shell.html 로 찾는다.

detaildesign.html 은 iframe 주소를 확장자 없이(`mockup-shell?preset=...`) 쓴다.
python -m http.server 는 그 주소에 404 를 주므로 이 서버를 쓴다.

    python3 .claude/skills/planner-qa/scripts/serve.py [--root .] [--port 8765]
"""
import argparse
import http.server
import os
import socketserver


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', default='.', help='저장소 루트 (기본: 현재 폴더)')
    ap.add_argument('--port', type=int, default=8765)
    args = ap.parse_args()
    root = os.path.abspath(args.root)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=root, **kw)

        def translate_path(self, path):
            p = super().translate_path(path)
            if not os.path.exists(p) and os.path.exists(p + '.html'):
                return p + '.html'
            return p

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', args.port), Handler) as httpd:
        print(f'serving {root} on http://127.0.0.1:{args.port}/', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
