<#
.SYNOPSIS
  Release a stuck Windows cursor clip, once or continuously.

.DESCRIPTION
  Chromium confines the OS cursor with ClipCursor while a page holds pointer
  lock. On a display with scaling, that rectangle can be left behind in logical
  (DIP) coordinates while the cursor moves in physical pixels — so on a
  1920x1200 screen at 125% the cursor ends up confined to the top-left
  1536x960 of the desktop and stays there after the lock has ended. Nothing a
  web page can do releases it, because the clip belongs to the browser process,
  not to the page.

  This releases it. `-Watch` leaves a guard running that does so whenever the
  signature reappears.

  The guard only acts on that specific signature: a clip anchored at the
  desktop origin whose size matches the desktop scaled down by the current DPI
  factor, within a pixel or two. A real fullscreen game confining the cursor to
  a monitor does not look like that and is left alone.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/cursor-guard.ps1
  Release the clip once, right now.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/cursor-guard.ps1 -Watch
  Leave it running while playing. Ctrl+C to stop.
#>
[CmdletBinding()]
param(
  [switch]$Watch,
  [int]$IntervalMs = 400
)

Add-Type -Name Cursor -Namespace Guard -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
[DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT r);
[DllImport("user32.dll")] public static extern bool ClipCursor(IntPtr r);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
[DllImport("user32.dll")] public static extern uint GetDpiForSystem();
'@

# Physical pixels, or every number below is the scaled lie that causes the bug.
[void][Guard.Cursor]::SetProcessDpiAwarenessContext([IntPtr](-4))

$SM_XVIRTUAL = 76; $SM_YVIRTUAL = 77; $SM_CXVIRTUAL = 78; $SM_CYVIRTUAL = 79

function Get-Desktop {
  [PSCustomObject]@{
    X = [Guard.Cursor]::GetSystemMetrics($SM_XVIRTUAL)
    Y = [Guard.Cursor]::GetSystemMetrics($SM_YVIRTUAL)
    W = [Guard.Cursor]::GetSystemMetrics($SM_CXVIRTUAL)
    H = [Guard.Cursor]::GetSystemMetrics($SM_CYVIRTUAL)
  }
}

function Get-Clip {
  $r = New-Object Guard.Cursor+RECT
  [void][Guard.Cursor]::GetClipCursor([ref]$r)
  $r
}

$desktop = Get-Desktop
# Ask the window manager, not the registry: `LogPixels` is absent on plenty of
# machines that are nevertheless scaled, and reading zero from it would make the
# guard decide there is no scaling and never fire.
$scale = 1.0
try { $scale = [double][Guard.Cursor]::GetDpiForSystem() / 96.0 } catch { $scale = 1.0 }
if ($scale -le 0) { $scale = 1.0 }

Write-Host ("desktop {0}x{1} physical, scaling {2:P0}" -f $desktop.W, $desktop.H, $scale)

<#
  True when the clip looks like the scaling bug rather than like a game:
  pinned at the desktop origin and sized to the desktop divided by the DPI
  factor. A tolerance of a few pixels covers rounding in the browser.
#>
function Test-StaleClip($clip, $desktop, $scale) {
  if ($clip.R - $clip.L -ge $desktop.W -and $clip.B - $clip.T -ge $desktop.H) { return $false }
  if ($clip.L -ne $desktop.X -or $clip.T -ne $desktop.Y) { return $false }
  if ($scale -le 1.001) { return $false }
  $expectedW = [Math]::Round($desktop.W / $scale)
  $expectedH = [Math]::Round($desktop.H / $scale)
  return ([Math]::Abs(($clip.R - $clip.L) - $expectedW) -le 3 -and
          [Math]::Abs(($clip.B - $clip.T) - $expectedH) -le 3)
}

function Release-Clip($clip, $why) {
  [void][Guard.Cursor]::ClipCursor([IntPtr]::Zero)
  Write-Host ("[{0}] released {1} clip {2}x{3}" -f (Get-Date -Format 'HH:mm:ss'), $why,
    ($clip.R - $clip.L), ($clip.B - $clip.T))
}

if (-not $Watch) {
  $clip = Get-Clip
  if ($clip.R - $clip.L -ge $desktop.W -and $clip.B - $clip.T -ge $desktop.H) {
    Write-Host 'cursor is not clipped; nothing to release'
  } else {
    Release-Clip $clip 'current'
  }
  return
}

Write-Host 'watching — Ctrl+C to stop'
while ($true) {
  $clip = Get-Clip
  if (Test-StaleClip $clip $desktop $scale) { Release-Clip $clip 'stale-scaling' }
  Start-Sleep -Milliseconds $IntervalMs
}
