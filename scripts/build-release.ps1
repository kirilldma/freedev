$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dist = Join-Path $repoRoot "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$env:CGO_ENABLED = "0"
Push-Location $repoRoot
try {
	$t = @(
		@{ GOOS = "linux"; GOARCH = "amd64"; Name = "freedev-linux-amd64" },
		@{ GOOS = "linux"; GOARCH = "arm64"; Name = "freedev-linux-arm64" },
		@{ GOOS = "linux"; GOARCH = "386"; Name = "freedev-linux-386" },
		@{ GOOS = "windows"; GOARCH = "amd64"; Name = "freedev-windows-amd64.exe" },
		@{ GOOS = "windows"; GOARCH = "386"; Name = "freedev-windows-386.exe" }
	)
	foreach ($x in $t) {
		$env:GOOS = $x.GOOS
		$env:GOARCH = $x.GOARCH
		$out = Join-Path $dist $x.Name
		go build -trimpath -ldflags "-s -w" -o $out ./cmd/freedev
		Write-Host "ok $out"
	}
}
finally {
	Remove-Item Env:\GOOS -ErrorAction SilentlyContinue
	Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue
	Pop-Location
}
