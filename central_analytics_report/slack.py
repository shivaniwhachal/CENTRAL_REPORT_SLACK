"""Upload the sheet picture and send the bot DM note."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request


class SlackError(RuntimeError):
    pass


class SlackClient:
    def __init__(self, token: str, opener=None):
        if not token:
            raise SlackError("SLACK_BOT_TOKEN is not set.")
        self.token = token
        self._opener = opener or urllib.request.urlopen

    def upload_png(
        self,
        channel_id: str,
        png_bytes: bytes,
        filename: str,
        title: str,
        comment: str,
    ) -> str:
        destination = self._destination(channel_id)
        reserved = self._api_form(
            "https://slack.com/api/files.getUploadURLExternal",
            {"filename": filename, "length": str(len(png_bytes))},
        )
        self._put_file(reserved["upload_url"], png_bytes, filename)
        completed = self._api_json(
            "https://slack.com/api/files.completeUploadExternal",
            {
                "files": [{"id": reserved["file_id"], "title": title}],
                "channel_id": destination,
                "initial_comment": comment,
            },
        )
        files = completed.get("files") or []
        if files and files[0].get("id"):
            return files[0]["id"]
        return reserved["file_id"]

    def post_text(self, channel_id: str, text: str) -> None:
        self._api_json(
            "https://slack.com/api/chat.postMessage",
            {"channel": self._destination(channel_id), "text": text},
        )

    def _destination(self, channel_id: str) -> str:
        """A member id (U…) is opened as a DM. A channel id is used as given."""
        if not channel_id.startswith("U"):
            return channel_id
        opened = self._api_json(
            "https://slack.com/api/conversations.open",
            {"users": channel_id},
        )
        return opened["channel"]["id"]

    def _api_form(self, url: str, fields: dict) -> dict:
        body = urllib.parse.urlencode(fields).encode()
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        return self._read(request)

    def _api_json(self, url: str, payload: dict) -> dict:
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        return self._read(request)

    def _put_file(self, upload_url: str, png_bytes: bytes, filename: str) -> None:
        boundary = "----CentralDailyViniReport"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: image/png\r\n\r\n"
        ).encode() + png_bytes + f"\r\n--{boundary}--\r\n".encode()
        request = urllib.request.Request(
            upload_url,
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with self._opener(request, timeout=60) as response:
                status = getattr(response, "status", 200)
                if status >= 400:
                    raise SlackError(f"file upload failed: HTTP {status}")
        except urllib.error.HTTPError as exc:
            raise SlackError(f"file upload failed: HTTP {exc.code}") from exc

    def _read(self, request: urllib.request.Request) -> dict:
        try:
            with self._opener(request, timeout=60) as response:
                payload = json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            raise SlackError(f"Slack HTTP {exc.code}") from exc
        if not payload.get("ok"):
            raise SlackError(payload.get("error") or "Slack request failed")
        return payload
