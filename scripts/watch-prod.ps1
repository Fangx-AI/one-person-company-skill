# 5 分钟生产健康监听 — 每 30s 一轮，捕捉 chat_sessions / messages / facts 变化
$base = if ($env:WATCH_BASE) { $env:WATCH_BASE } else { "https://bookofelon.cn" }
$rounds = if ($env:WATCH_ROUNDS) { [int]$env:WATCH_ROUNDS } else { 10 }
$interval = if ($env:WATCH_INTERVAL) { [int]$env:WATCH_INTERVAL } else { 30 }

Write-Host "Watching $base — $rounds rounds, ${interval}s each (~$($rounds * $interval / 60)min)"
Write-Host ""

$prev = $null
for ($i = 1; $i -le $rounds; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -TimeoutSec 10
    $j = $r.Content | ConvertFrom-Json
    $c = $j.db.counts
    $line = ("[{0:HH:mm:ss}] r{1,2}/{2}  status={3} db={4} llm={5} circuit={6}  users={7} sessions={8} msgs={9} facts={10} goals={11}  heap={12:N1}MB" -f `
      (Get-Date), $i, $rounds, $j.status, $j.db.status, $j.llm.status, $j.llm.circuit_open, $c.users, $c.chat_sessions, $c.messages, $c.facts, $c.goals, $j.process.heap_mb)

    if ($prev) {
      $delta = @()
      if ($c.users -ne $prev.users) { $delta += "users +$($c.users - $prev.users)" }
      if ($c.chat_sessions -ne $prev.chat_sessions) { $delta += "sessions +$($c.chat_sessions - $prev.chat_sessions)" }
      if ($c.messages -ne $prev.messages) { $delta += "msgs +$($c.messages - $prev.messages)" }
      if ($c.facts -ne $prev.facts) { $delta += "facts +$($c.facts - $prev.facts)" }
      if ($c.goals -ne $prev.goals) { $delta += "goals +$($c.goals - $prev.goals)" }
      if ($delta.Count -gt 0) { $line += "  <-- " + ($delta -join " ") }
    }

    if ($j.status -ne "ok" -or $j.db.status -ne "ok" -or $j.llm.circuit_open -eq $true) {
      Write-Host $line -ForegroundColor Red
    } elseif ($line -match "<--") {
      Write-Host $line -ForegroundColor Green
    } else {
      Write-Host $line
    }
    $prev = $c
  } catch {
    Write-Host ("[{0:HH:mm:ss}] r{1,2}/{2}  ERROR: {3}" -f (Get-Date), $i, $rounds, $_.Exception.Message) -ForegroundColor Red
  }
  if ($i -lt $rounds) { Start-Sleep -Seconds $interval }
}
Write-Host ""
Write-Host "watch done"
