package webassets

import (
	"embed"
	"io/fs"
)

//go:embed dist
var embedded embed.FS

// Assets returns the built frontend with dist as its root.
func Assets() fs.FS {
	assets, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic(err)
	}
	return assets
}
