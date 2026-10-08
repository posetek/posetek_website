"""Resolve only a trusted mobile contract artifact for a future PR check.

The returned run ID is passed to a pinned download-artifact action. This module
does not download or execute artifact contents and has no mobile App credential.
"""
from pathlib import Path
import json
import os
import re
from urllib.parse import quote
from urllib.request import Request, urlopen

REPOSITORY = "posetek/posetek_website"
SOURCE_WORKFLOW = re.compile(
    r"^(?:posetek/posetek_website/)?\.github/workflows/mobile-contract-source\.yml(?:@(?:refs/heads/)?main)?$"
)
MAX_BYTES = 10 * 1024 * 1024


def select_artifact(artifacts, get_run, sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Reviewed mobile SHA must be full lowercase hex")
    expected_name = "mobile-contract-" + sha
    for artifact in artifacts:
        if artifact.get("name") != expected_name or artifact.get("expired") is not False:
            continue
        artifact_id = artifact.get("id")
        run_id = (artifact.get("workflow_run") or {}).get("id")
        size = artifact.get("size_in_bytes")
        if not all(type(value) is int and value > 0 for value in (artifact_id, run_id, size)) or size > MAX_BYTES:
            continue
        run = get_run(run_id)
        if run.get("id") != run_id or run.get("event") != "workflow_dispatch":
            continue
        if run.get("status") != "completed" or run.get("conclusion") != "success":
            continue
        if run.get("head_branch") != "main" or not SOURCE_WORKFLOW.fullmatch(run.get("path") or ""):
            continue
        if (run.get("repository") or {}).get("full_name") != REPOSITORY:
            continue
        return {"run_id": run_id, "artifact_id": artifact_id, "sha": sha}
    raise ValueError(f"No completed trusted mobile contract artifact for {sha}")


def _get_json(path, token):
    request = Request(
        "https://api.github.com/repos/" + REPOSITORY + path,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "posetek-mobile-contract-ci"},
    )
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def main():
    token = os.environ.get("GH_TOKEN")
    output = os.environ.get("GITHUB_OUTPUT")
    if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY or not token or not output:
        raise SystemExit("Repository, Actions-read token and output file are required")
    manifest = json.loads((Path(__file__).resolve().parent / "mobile-contract-source.json").read_text())
    if set(manifest) != {"repository", "sha"} or manifest["repository"] != "posetek/posetek-mobile-app":
        raise SystemExit("Invalid reviewed mobile source manifest")
    sha = manifest["sha"]
    name = "mobile-contract-" + sha
    data = _get_json("/actions/artifacts?name=" + quote(name) + "&per_page=100", token)
    evidence = select_artifact(data.get("artifacts", []), lambda run_id: _get_json(f"/actions/runs/{run_id}", token), sha)
    with open(output, "a", encoding="utf8") as stream:
        stream.write(f"run-id={evidence['run_id']}\nartifact-id={evidence['artifact_id']}\n")
    print(f"Trusted mobile source: {sha}, run {evidence['run_id']}, artifact {evidence['artifact_id']}")


if __name__ == "__main__":
    main()
