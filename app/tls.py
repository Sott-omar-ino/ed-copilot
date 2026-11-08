"""HTTPS per il companion sul telefono.

I browser dei telefoni concedono il microfono (getUserMedia) solo su HTTPS: qui creiamo un certificato
autofirmato (una volta sola, rigenerato se cambia l'IP della rete locale) e lo usiamo per il server LAN.

La cifratura avviene nel thread di ogni richiesta, non in accept(): un client che apre la connessione e
non parla non può bloccare il server. Chi apre per errore l'indirizzo http:// viene rediretto a https://.
"""
import datetime
import hashlib
import ipaddress
import os
import socket
import ssl
import types

from . import paths
from .lang import pick

HANDSHAKE_TIMEOUT = 10  # secondi concessi al telefono per completare l'handshake TLS
VALID_DAYS = 825        # massimo accettato da iOS/macOS per i certificati server (rigenerato 30 giorni prima)
RENEW_DAYS = 30
CN = "ED Copilot"


def available():
    try:
        import cryptography  # noqa: F401
        return True
    except ImportError:
        return False


def _dir():
    folder = paths.cache_file("tls")
    os.makedirs(folder, exist_ok=True)
    return folder


def _cert_ok(cert_path, key_path, ip):
    """Vero se il certificato esiste, non sta per scadere e contiene l'IP attuale."""
    if not (os.path.isfile(cert_path) and os.path.isfile(key_path)):
        return False
    try:
        from cryptography import x509
        with open(cert_path, "rb") as f:
            cert = x509.load_pem_x509_certificate(f.read())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        ips = {str(a) for a in san.get_values_for_type(x509.IPAddress)}
        try:
            expires = cert.not_valid_after_utc
        except AttributeError:  # cryptography < 42
            expires = cert.not_valid_after.replace(tzinfo=datetime.timezone.utc)
        fresh = expires - datetime.datetime.now(datetime.timezone.utc) > datetime.timedelta(days=RENEW_DAYS)
        return fresh and str(ipaddress.ip_address(ip)) in ips
    except Exception as exc:
        print(f"[TLS] Certificato non leggibile, lo rigenero: {exc!r}")
        return False


def _generate(cert_path, key_path, ip):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, CN)])
    alt = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    if ip and ip != "127.0.0.1":
        alt.insert(0, x509.IPAddress(ipaddress.ip_address(ip)))
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=VALID_DAYS))
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, key_encipherment=False, content_commitment=False,
                                     data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                     crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    with open(key_path, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                  serialization.NoEncryption()))
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    print(f"[TLS] Nuovo certificato per {ip} creato in {os.path.dirname(cert_path)}")


def ensure_cert(ip):
    """Percorsi (certificato, chiave) validi per l'IP dato; li crea o rigenera se serve."""
    folder = _dir()
    cert_path, key_path = os.path.join(folder, "companion.crt"), os.path.join(folder, "companion.key")
    if not _cert_ok(cert_path, key_path, ip):
        _generate(cert_path, key_path, ip)
    return cert_path, key_path


def fingerprint(cert_path):
    """Impronta SHA-256 del certificato, nel formato mostrato dai browser (AB:CD:...)."""
    with open(cert_path, "r", encoding="ascii") as f:
        der = ssl.PEM_cert_to_DER_cert(f.read())
    digest = hashlib.sha256(der).hexdigest().upper()
    return ":".join(digest[i:i + 2] for i in range(0, len(digest), 2))


def context(cert_path, key_path):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(cert_path, key_path)
    return ctx


def _redirect_plain_http(sock):
    """Il telefono ha aperto http:// sulla porta HTTPS: rispondiamo con un redirect a https://."""
    data = b""
    try:
        while b"\r\n\r\n" not in data and len(data) < 8192:
            chunk = sock.recv(2048)
            if not chunk:
                return
            data += chunk
        lines = data.split(b"\r\n")
        parts = lines[0].split(b" ")
        target = parts[1].decode("latin-1") if len(parts) >= 2 else "/"
        host = ""
        for line in lines[1:]:
            if line.lower().startswith(b"host:"):
                host = line[5:].strip().decode("latin-1")
        if not target.startswith("/"):
            target = "/"
        safe = lambda s: not any(c in s for c in "\r\n\0 ")  # niente header iniettati
        if not host or not safe(host) or not safe(target):
            host, target = sock.getsockname()[0] + ":" + str(sock.getsockname()[1]), "/"
        body = pick("Apri l'indirizzo https:// del companion.", "Open the companion's https:// address.").encode("utf-8")
        sock.sendall(
            b"HTTP/1.1 301 Moved Permanently\r\nLocation: https://" + host.encode("latin-1") + target.encode("latin-1")
            + b"\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + str(len(body)).encode()
            + b"\r\nConnection: close\r\n\r\n" + body)
    except OSError:
        pass


def wrap(server, ip):
    """Rende HTTPS un ThreadingHTTPServer già creato (prima di serve_forever). Restituisce l'impronta SHA-256.

    accept() resta un semplice accept TCP; la cifratura avviene in finish_request, che ThreadingMixIn esegue
    nel thread della singola connessione, con un timeout sull'handshake.
    """
    cert_path, key_path = ensure_cert(ip)
    ctx = context(cert_path, key_path)
    original_finish = server.finish_request

    def finish_request(self, request, client_address):
        try:
            request.settimeout(HANDSHAKE_TIMEOUT)
            first = request.recv(1, socket.MSG_PEEK)
            if not first:
                return
            if first != b"\x16":  # non è un handshake TLS: probabilmente http:// in chiaro
                return _redirect_plain_http(request)
            tls_sock = ctx.wrap_socket(request, server_side=True)  # handshake qui, entro HANDSHAKE_TIMEOUT
        except (OSError, ssl.SSLError):
            # Telefono che rifiuta il certificato, scanner, connessione muta: chiudiamo senza rumore.
            return
        try:
            tls_sock.settimeout(None)  # poi come il server HTTP normale
            original_finish(tls_sock, client_address)
        except (ssl.SSLError, ConnectionError, TimeoutError):
            pass
        finally:
            try:
                tls_sock.close()
            except OSError:
                pass

    server.finish_request = types.MethodType(finish_request, server)
    server.tls_fingerprint = fingerprint(cert_path)
    return server.tls_fingerprint
