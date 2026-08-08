<#
.SYNOPSIS
  Release a stuck Windows cursor clip, once or continuously.

.DESCRIPTION
  Chromium confines the OS cursor with ClipCursor while a page holds pointer
  lock, and the rectangle it uses is the browser window. On a display with
  scaling that rectangle can be left behind in logical (DIP) coordinates while
  the cursor moves in physical pixels, so the cursor stays penned into a region
  of the screen after the lock has ended. Alt-Tab clears it because Windows
  drops the clip when the clipping window loses foreground activation - which
  is also how you can tell this is what you are looking at.

  Nothing a web page can do releases it: the clip belongs to the browser
  process, not to the document. This releases it. -Watch leaves a guard running
  that does so whenever it comes back.

  ASCII only, on purpose: Windows PowerShell 5.1 reads this file as ANSI and a
  stray em dash is a parse error, which is a silly way for a guard to be dead.

.PARAMETER Strict
  Only release a clip matching the DPI-scaling signature exactly (anchored at
  the desktop origin, sized to the desktop over the scale factor). Safer around
  native fullscreen games, but it misses the common case, because the clip
  Chromium leaves behind is its window rectangle and matches no signature.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/cursor-guard.ps1
  Release the clip once, right now.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/cursor-guard.ps1 -Watch
  Leave it running while playing in the browser. Ctrl+C to stop.

.NOTES
  While -Watch is running, a native fullscreen game that legitimately confines
  the cursor to one monitor will also be released. Stop the guard before
  playing one, or use -Strict.
#>
[CmdletBinding()]
param(
  [switch]$Watch,
  [int]$IntervalMs = 250,
  [switch]$Strict,
  [string]$LogPath
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

$desktop = [PSCustomObject]@{
  X = [Guard.Cursor]::GetSystemMetrics($SM_XVIRTUAL)
  Y = [Guard.Cursor]::GetSystemMetrics($SM_YVIRTUAL)
  W = [Guard.Cursor]::GetSystemMetrics($SM_CXVIRTUAL)
  H = [Guard.Cursor]::GetSystemMetrics($SM_CYVIRTUAL)
}

# Ask the window manager, not the registry: LogPixels is absent on plenty of
# scaled machines, and reading zero from it would make the guard decide there
# is no scaling at all.
$scale = 1.0
try { $scale = [double][Guard.Cursor]::GetDpiForSystem() / 96.0 } catch { $scale = 1.0 }
if ($scale -le 0) { $scale = 1.0 }

Write-Host ("desktop {0}x{1} physical, scaling {2:P0}" -f $desktop.W, $desktop.H, $scale)

function Get-Clip {
  $r = New-Object Guard.Cursor+RECT
  [void][Guard.Cursor]::GetClipCursor([ref]$r)
  $r
}

function Test-Clipped($clip) {
  return (($clip.R - $clip.L) -lt $desktop.W) -or (($clip.B - $clip.T) -lt $desktop.H)
}

# The clip written in logical coordinates over a physical desktop: pinned at
# the origin and sized to the desktop divided by the DPI factor.
function Test-ScalingSignature($clip) {
  if ($scale -le 1.001) { return $false }
  if ($clip.L -ne $desktop.X -or $clip.T -ne $desktop.Y) { return $false }
  $expectedW = [Math]::Round($desktop.W / $scale)
  $expectedH = [Math]::Round($desktop.H / $scale)
  return (([Math]::Abs(($clip.R - $clip.L) - $expectedW) -le 3) -and
          ([Math]::Abs(($clip.B - $clip.T) - $expectedH) -le 3))
}

function Invoke-Step {
  $clip = Get-Clip
  if (-not (Test-Clipped $clip)) { return $false }
  $signature = Test-ScalingSignature $clip
  if ($Strict -and -not $signature) { return $false }
  [void][Guard.Cursor]::ClipCursor([IntPtr]::Zero)
  $why = if ($signature) { 'stale-scaling' } else { 'confined' }
  $line = "[{0}] released {1} clip {2}x{3} at {4},{5}" -f (Get-Date -Format 'HH:mm:ss'),
    $why, ($clip.R - $clip.L), ($clip.B - $clip.T), $clip.L, $clip.T
  Write-Host $line
  if ($LogPath) { Add-Content -Path $LogPath -Value $line }
  return $true
}

if (-not $Watch) {
  if (-not (Invoke-Step)) { Write-Host 'cursor is not clipped; nothing to release' }
  return
}

$mode = ''
if ($Strict) { $mode = ', strict' }
Write-Host ("watching every {0}ms{1} - Ctrl+C to stop" -f $IntervalMs, $mode)
while ($true) {
  [void](Invoke-Step)
  Start-Sleep -Milliseconds $IntervalMs
}
