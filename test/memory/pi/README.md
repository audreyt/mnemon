# Pi Memory integration tests

Run `go test ./test/memory/pi -v -count=1` with Node.js 24 or newer. Set
`MNEMON_TEST_BIN` to reuse a built product; otherwise the suite builds one.
These process and JavaScript tests are excluded from `make test` and included
in `make test-integration`.

The **Manual Integration** workflow's `pi-windows` selection runs this suite
on native Windows with Node 24.16.0. `all` includes it alongside the existing
Linux and ZCode suites. The tests execute real `setup`, `remember`, `status`,
and eject commands in temporary profiles containing spaces and Chinese text.
Windows children have `HOME` removed and use `USERPROFILE`; both default and
custom data/config directories are checked. A raw Node process loads the
installed TypeScript extension, so a host wrapper cannot hide the home-path
or `.cmd` process boundary.

Native and standard global/local npm layouts use the actual built binary.
The npm fixtures copy this checkout's launcher and target registry and place
the binary in the matching optional package; they do not contact the registry.
The unchanged `testdata/memory/pi/mnemon-before-164.ts` fixture comes from
`8cd1713135cb2c0757962c4e6ad0642114a42975` and runs in the same environment to
prove the old Claude guide injection, missing Windows home paths, and failed
Windows npm status call. Mocked callbacks cover path selection and error
handling independently. Unix process tests prove timeout/output bounds kill
and reap both direct and npm-resolved children, including SIGTERM-ignoring
children, and preserve ordinary PATH lookup and custom executable wrappers.

These tests cover the Memory extension's guide, resource discovery, and status
process. They do not exercise a model provider or certify every Pi lifecycle
event. Actual Pi host sessions are a separate runtime check.
