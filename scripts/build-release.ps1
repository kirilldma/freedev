$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dist = Join-Path $repoRoot "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$env:CGO_ENABLED = "0"
Push-Location $repoRoot
try {
	$t = @(
		@{ GOOS = "linux"; GOARCH = "amd64"; GOARM = ""; Name = "freedev-linux-amd64" },
		@{ GOOS = "linux"; GOARCH = "arm64"; GOARM = ""; Name = "freedev-linux-arm64" },
		@{ GOOS = "linux"; GOARCH = "386"; GOARM = ""; Name = "freedev-linux-386" },
		@{ GOOS = "linux"; GOARCH = "arm"; GOARM = "7"; Name = "freedev-linux-armv7" },
		@{ GOOS = "darwin"; GOARCH = "amd64"; GOARM = ""; Name = "freedev-darwin-amd64" },
		@{ GOOS = "darwin"; GOARCH = "arm64"; GOARM = ""; Name = "freedev-darwin-arm64" },
		@{ GOOS = "windows"; GOARCH = "amd64"; GOARM = ""; Name = "freedev-windows-amd64.exe" },
		@{ GOOS = "windows"; GOARCH = "386"; GOARM = ""; Name = "freedev-windows-386.exe" },
		@{ GOOS = "windows"; GOARCH = "arm64"; GOARM = ""; Name = "freedev-windows-arm64.exe" }
	)
	foreach ($x in $t) {
		$env:GOOS = $x.GOOS
		$env:GOARCH = $x.GOARCH
		if ($x.GOARM -ne "") { $env:GOARM = $x.GOARM } else { Remove-Item Env:\GOARM -ErrorAction SilentlyContinue }
		$out = Join-Path $dist $x.Name
		go build -trimpath -ldflags "-s -w" -o $out ./cmd/freedev
		Write-Host "ok $out"
	}
}
finally {
	Remove-Item Env:\GOOS -ErrorAction SilentlyContinue
	Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue
	Remove-Item Env:\GOARM -ErrorAction SilentlyContinue
	Pop-Location
}
