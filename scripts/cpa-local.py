#!/usr/bin/env python3
"""Manage a private, localhost-only CLIProxyAPI for personal Easy Learn use."""

import argparse
import base64
import hashlib
import json
import os
import secrets
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import ProxyHandler, Request, build_opener, urlopen

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".cache" / "cpa"
BIN = STATE / "cli-proxy-api"
CONFIG = STATE / "config.yaml"
AUTH_DIR = STATE / "auth"
AUTH = AUTH_DIR / "codex-current-plus.json"
KEY = STATE / "extension-key"
PID = STATE / "server.pid"
LOG = STATE / "server.log"
VERSION = "7.3.15"
ARCHIVE = STATE / f"CLIProxyAPI_{VERSION}_linux_amd64.tar.gz"
ARCHIVE_URL = (
    f"https://github.com/router-for-me/CLIProxyAPI/releases/download/v{VERSION}/{ARCHIVE.name}"
)
ARCHIVE_SHA256 = "801c3a23061d57a830e67fcd033fda26e96c2bfe93e1b2e34e4428ed7defc7e5"
LOCAL_URL = "http://127.0.0.1:8317/v1/models"


def private_file(path: Path, content: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as file:
        file.write(content)
    os.chmod(path, 0o600)


def endpoint_status() -> int | None:
    if not KEY.is_file():
        return None
    opener = build_opener(ProxyHandler({}))
    request = Request(LOCAL_URL, headers={"Authorization": "Bearer " + KEY.read_text().strip()})
    try:
        with opener.open(request, timeout=2) as response:
            return response.status
    except HTTPError as error:
        return error.code
    except (URLError, TimeoutError, OSError):
        return None


def ensure_binary() -> None:
    if BIN.is_file():
        return
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not ARCHIVE.is_file():
        print(f"从官方发布页下载 CLIProxyAPI v{VERSION}…")
        with urlopen(ARCHIVE_URL, timeout=90) as response, ARCHIVE.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    with ARCHIVE.open("rb") as archive_file:
        digest = hashlib.file_digest(archive_file, "sha256").hexdigest()
    if digest != ARCHIVE_SHA256:
        raise RuntimeError("CPA 安装包校验失败，请删除 .cache/cpa 中的安装包后重试。")
    with tarfile.open(ARCHIVE, "r:gz") as package:
        member = next(
            (
                item
                for item in package.getmembers()
                if item.name == "cli-proxy-api" and item.isfile()
            ),
            None,
        )
        if member is None:
            raise RuntimeError("CPA 安装包中缺少可执行程序。")
        source = package.extractfile(member)
        if source is None:
            raise RuntimeError("无法解压 CPA 可执行程序。")
        with tempfile.NamedTemporaryFile(dir=STATE, delete=False) as output:
            temp_path = Path(output.name)
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
    temp_path.chmod(0o700)
    temp_path.replace(BIN)


def import_auth(path: Path) -> None:
    source = json.loads(path.read_text())
    tokens = source.get("tokens") or {}
    required = ("access_token", "refresh_token", "id_token", "account_id")
    if source.get("auth_mode") != "chatgpt" or any(not tokens.get(name) for name in required):
        raise RuntimeError("所选文件不是可用的 ChatGPT Codex 登录凭据。")
    AUTH_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    AUTH_DIR.chmod(0o700)

    # CPA reads its own copy; never edit the Codex application's auth.json.
    def claim(token: str) -> dict:
        try:
            payload = token.split(".")[1]
            return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        except (IndexError, ValueError, json.JSONDecodeError):
            return {}

    access_claims = claim(tokens["access_token"])
    id_claims = claim(tokens["id_token"])
    expiry = access_claims.get("exp")
    expires_at = (
        datetime.fromtimestamp(expiry, timezone.utc).isoformat().replace("+00:00", "Z")
        if isinstance(expiry, int)
        else ""
    )
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    item = {
        "type": "codex",
        "email": id_claims.get("email", ""),
        "account_id": tokens["account_id"],
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "id_token": tokens["id_token"],
        "expired": expires_at,
        "last_refresh": now,
        "saved_at": now,
        "disabled": False,
    }
    private_file(AUTH, json.dumps(item, ensure_ascii=False, indent=2) + "\n")


def setup(args: argparse.Namespace) -> None:
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.chmod(0o700)
    ensure_binary()
    if args.auth_file:
        import_auth(Path(args.auth_file).expanduser())
    elif not AUTH.is_file():
        raise RuntimeError("需要通过 --auth-file 指定已登录 Codex 的 auth.json。")
    if not KEY.is_file():
        private_file(KEY, secrets.token_urlsafe(32) + "\n")
    KEY.chmod(0o600)
    if not CONFIG.is_file() or args.proxy_url:
        if args.proxy_url:
            proxy_address = urlparse(args.proxy_url)
            if (
                proxy_address.scheme not in ("http", "https", "socks5", "socks5h")
                or not proxy_address.hostname
                or not proxy_address.port
            ):
                raise RuntimeError("代理地址需要使用带主机和端口的 http、https 或 socks5 地址。")
        proxy = "proxy-url: " + json.dumps(args.proxy_url) + "\n" if args.proxy_url else ""
        config = (
            'host: "127.0.0.1"\n'
            "port: 8317\n"
            f'auth-dir: "{AUTH_DIR}"\n'
            "api-keys:\n"
            f'  - "{KEY.read_text().strip()}"\n'
            "remote-management:\n"
            "  allow-remote: false\n"
            '  secret-key: ""\n'
            "  disable-control-panel: true\n"
            "debug: false\n" + proxy
        )
        private_file(CONFIG, config)
    print("本机 CPA 已准备好；访问密钥保存在 .cache/cpa/extension-key。")
    start()


def start() -> None:
    status = endpoint_status()
    if status == 200:
        print("本机 CPA 已在运行。")
        return
    if status is not None:
        raise RuntimeError(f"127.0.0.1:8317 已被其他服务占用（HTTP {status}）。")
    if not BIN.is_file() or not CONFIG.is_file() or not AUTH.is_file() or not KEY.is_file():
        raise RuntimeError("请先运行 setup，准备程序、配置和凭据。")
    log_fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(log_fd, "ab") as output:
        process = subprocess.Popen(
            [str(BIN), "-config", str(CONFIG)],
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    private_file(PID, str(process.pid) + "\n")
    for _ in range(40):
        time.sleep(0.25)
        if endpoint_status() == 200:
            print("本机 CPA 已启动：127.0.0.1:8317。")
            return
        if process.poll() is not None:
            break
    raise RuntimeError("CPA 未能启动，请检查 .cache/cpa/server.log。")


def stop() -> None:
    if not PID.is_file():
        print("没有由项目启动工具管理的 CPA 进程。")
        return
    pid = int(PID.read_text().strip())
    command = Path(f"/proc/{pid}/cmdline")
    if command.is_file() and str(BIN).encode() in command.read_bytes():
        os.kill(pid, signal.SIGTERM)
        print("本机 CPA 已停止。")
    else:
        print("记录的进程不再是本项目的 CPA；未终止任何进程。")
    PID.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    setup_parser = sub.add_parser("setup", help="准备并启动 CPA")
    setup_parser.add_argument("--auth-file", help="已登录 Codex 的 auth.json 路径")
    setup_parser.add_argument("--proxy-url", help="CPA 出站代理地址，例如 socks5://127.0.0.1:7890")
    sub.add_parser("start", help="启动 CPA")
    sub.add_parser("status", help="检查 CPA")
    sub.add_parser("stop", help="停止 CPA")
    args = parser.parse_args()
    try:
        if args.action == "setup":
            setup(args)
        elif args.action == "start":
            start()
        elif args.action == "status":
            ready = endpoint_status() == 200
            print("本机 CPA 连接正常。" if ready else "本机 CPA 未就绪。")
            if not ready:
                sys.exit(1)
        else:
            stop()
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"错误：{error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
