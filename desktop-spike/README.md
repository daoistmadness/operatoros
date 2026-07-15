# Desktop Sidecar Feasibility Spike

Experimental only. This directory does not participate in production deployment.

On Windows, create a disposable Python 3.12 virtual environment, install `backend/requirements.txt` plus either `pyinstaller` or `nuitka`, then run the matching PowerShell build script. Outputs belong under `desktop-spike/output/` and are intentionally not source artifacts.

Run the lifecycle prototype with:

```powershell
python desktop-spike/supervisor.py desktop-spike/output/pyinstaller/AstryxBackend.exe --data-root "$env:TEMP\AstryxSpike"
```

The executable binds only to loopback and defaults writable data to `%LOCALAPPDATA%\Astryx`. Use `ASTRYX_DATA_ROOT` for disposable validation. It applies only the two migration-owned identity/setup bootstrap scripts before normal application initialization. This is evidence-gathering code, not an approved general migration runner.
