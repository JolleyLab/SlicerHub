# Extra CA certificates for Docker builds (optional)

**Most installs need no certificates here.** They are only needed on networks that
intercept HTTPS with their own certificate authority (for example Netskope or Zscaler).
Symptoms: `CERTIFICATE_VERIFY_FAILED`, `SELF_SIGNED_CERT_IN_CHAIN`, or wget's
`cannot verify … certificate` during `docker compose build`, `pip install`, or `npm ci`.
(`x509` errors while pulling images are fixed on the host; see Troubleshooting in
[DEPLOYMENT.md](../DEPLOYMENT.md#troubleshooting).)

Put the proxy's CA certificates here as PEM files ending in `.crt`, **one certificate
per file**. Ubuntu's `update-ca-certificates` skips a multi-certificate file when it
indexes `/etc/ssl/certs`, and tools such as wget then reject the proxy's certificates.
Everything in this folder except this README is git-ignored. When the folder holds no
`.crt` files, no extra CA is installed. Keep the folder itself, because compose builds
fail without it.

How it is wired:

- Each Dockerfile declares an empty `certs` stage. `docker-compose.yml` replaces it
  with this folder via `additional_contexts`, and the build copies any `*.crt` here
  into the image's system CA store. It also points pip, requests, and Node at that store.
- The Full Slicer base image also adds them to Slicer's own `Slicer.crt`.
- `slicer-gui-gpu/build.ps1` and `build.sh` pass the folder with `--build-context`.
- The Vast GPU image (`scripts/vast`) is not covered.
- `payload-admin` runs a stock image, so it mounts this folder at `/certs`, and Node needs
  all the certificates in **one** file. Concatenate them into a `.pem` file (not `.crt`,
  so the builds don't install it twice), for example `corporate-ca-bundle.pem`. Then set
  `CONTAINER_EXTRA_CA_CERTS=/certs/corporate-ca-bundle.pem` in `.env`.

Images built with an extra CA trust that CA. Don't push those images to a shared registry.

## Exporting the CA on Windows

The proxy's CA certificates are usually already in the Windows certificate store. Find
their thumbprints:

```powershell
Get-ChildItem Cert:\LocalMachine\Root | Where-Object Subject -match 'netskope|goskope' |
  Select-Object Subject, Thumbprint
```

Export each one to its own file, and append it to the bundle for `payload-admin`:

```powershell
$c = Get-Item Cert:\LocalMachine\Root\<THUMBPRINT>
$pem = "-----BEGIN CERTIFICATE-----`n" +
  ([Convert]::ToBase64String($c.RawData) -replace '.{64}', "`$0`n").TrimEnd("`n") +
  "`n-----END CERTIFICATE-----`n"
$pem | Set-Content -Encoding ascii -NoNewline certs\<name>.crt
$pem | Add-Content -Encoding ascii -NoNewline certs\corporate-ca-bundle.pem
```

Then rebuild:

```bash
docker compose build
docker compose --profile slicer-gui build slicer-gui-base slicer-gui
```
