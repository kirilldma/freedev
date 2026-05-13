.PHONY: release clean vet

DIST := dist
LDFLAGS := -s -w

release: clean
	mkdir -p $(DIST)
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(DIST)/freedev-linux-amd64 ./cmd/freedev
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(DIST)/freedev-linux-arm64 ./cmd/freedev
	GOOS=linux GOARCH=386 CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(DIST)/freedev-linux-386 ./cmd/freedev
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(DIST)/freedev-windows-amd64.exe ./cmd/freedev
	GOOS=windows GOARCH=386 CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(DIST)/freedev-windows-386.exe ./cmd/freedev

clean:
	rm -rf $(DIST)

vet:
	go vet ./...
