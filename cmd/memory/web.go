package memory

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/mnemon-dev/mnemon/internal/memory/store"
	memoryweb "github.com/mnemon-dev/mnemon/internal/memory/web"
	webassets "github.com/mnemon-dev/mnemon/web"
	"github.com/spf13/cobra"
)

func webCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "web",
		Short: "Browse agent memories in a local knowledge workspace",
		Long:  "Serve a local, read-only memory library, relationship graph, entity explorer, and activity view. Agent writes remain visible while you browse.",
		Args:  cobra.NoArgs,
		RunE:  runWeb,
	}
	command.Flags().Int("port", 8484, "loopback HTTP port (0 chooses an available port)")
	return command
}

func init() {
	rootCmd.AddCommand(webCommand())
}

func runWeb(command *cobra.Command, _ []string) error {
	if readOnly {
		return errors.New("web uses live read-only access; --readonly selects an immutable CLI snapshot and cannot be used with web")
	}
	name := resolveStoreName()
	if !store.ValidStoreName(name) {
		return fmt.Errorf("invalid store name %q", name)
	}
	port, err := command.Flags().GetInt("port")
	if err != nil {
		return err
	}
	if port < 0 || port > 65535 {
		return errors.New("--port must be between 0 and 65535")
	}
	lifetime, stop := signal.NotifyContext(command.Context(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return serveWeb(lifetime, port, memoryweb.NewHandler(dataDir, name, version, webassets.Assets()), command.OutOrStdout())
}

func serveWeb(ctx context.Context, port int, handler http.Handler, output io.Writer) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return fmt.Errorf("listen for web workspace: %w", err)
	}
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    32 << 10,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	finished := make(chan error, 1)
	go func() { finished <- server.Serve(listener) }()
	_, _ = fmt.Fprintf(output, "Mnemon Web: http://%s\nRead-only workspace · press Ctrl+C to stop\n", listener.Addr())
	select {
	case err := <-finished:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve web workspace: %w", err)
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := server.Shutdown(shutdown)
		cancel()
		if err != nil {
			_ = server.Close()
		}
		serveErr := <-finished
		if !errors.Is(serveErr, http.ErrServerClosed) {
			err = errors.Join(err, serveErr)
		}
		return err
	}
}
