@echo off
REM Cost Peep launcher - LAN-bound, live mode.
REM Serves the dashboard on http://<this-PC-LAN-IP>:3000 so anyone on the
REM network (e.g. another tenant) can open it in a browser. Read-only toward the
REM Spark cluster: only GETs /metrics.

cd /d "%~dp0"

REM Settings
set COST_PEEP_MODE=live
set VLLM_BASE_URL=http://192.168.0.182:8000
REM API key only needed for generating load, not for the dashboard itself.
REM Set it in your user environment variables if you want load tests.

echo ============================================
echo  Cost Peep - live dashboard
echo  URL for both of you: http://192.168.0.234:3000
echo  (pin this URL to the taskbar in Edge/Chrome)
echo  Close this window to stop the dashboard.
echo ============================================

npm run dev -- -H 0.0.0.0 -p 3000
