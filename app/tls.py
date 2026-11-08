"""HTTPS per il companion sul telefono.

I browser dei telefoni concedono il microfono (getUserMedia), i service worker e l'installazione come app solo su
connessioni sicure (HTTPS). Fonti: MDN "Using Service Workers" ("Service workers are restricted to running across HTTPS
for security reasons") e web.dev/articles/install-criteria ("Be served over HTTPS").

Certificati (cartella cache/tls dei dati dell'app), creati una volta per PC:
- CA RADICE "ED Copilot" (ca.crt): è il certificato che si installa e si rende attendibile sul telefono. La sua chiave
  privata NON viene mai salvata: serve solo un istante per firmare la CA intermedia e poi viene buttata. Nessuno, nemmeno
  chi copiasse la cartella dei dati, può più usarla per firmare altro.
- CA INTERMEDIA (ca-int.crt + ca-int.key): firma il certificato del server. Ha gli stessi vincoli della radice.
- certificato del SERVER (companion.crt + companion.key): solo per l'IP del PC nella rete locale (SAN iPAddress),
  rigenerato quando cambia l'IP o sta per scadere. Il server invia certificato + intermedia (companion-chain.pem).

Vincoli sui nomi (X.509 NameConstraints, RFC 5280 §4.2.1.10, estensione critica: "Conforming CAs MUST mark this extension
as critical"), sia nella radice sia nell'intermedia: sono ammessi SOLO indirizzi IP delle reti private (RFC 1918:
10/8, 172.16/12, 192.168/16; RFC 6598: 100.64/10, usata anche dalle reti virtuali) e, per i nomi DNS, solo il dominio
riservato "invalid" (RFC 6761 §6.4, non esiste su internet). Il vincolo DNS serve perché per RFC 5280 "Restrictions
apply only when the specified name form is present": senza, i nomi DNS sarebbero liberi. Quindi anche se un telefono
si fida di questa CA, non può valere per nessun sito internet.
Perché anche l'intermedia: i vincoli nella CA radice (trust anchor) non sono applicati ovunque. Chromium li applica
su Windows (net/cert/internal/trust_store_win.cc: "WithEnforceAnchorConstraints()") ma per le radici aggiunte
dall'utente su Android le carica con un semplice AddTrustAnchor (net/cert/internal/trust_store_android.cc); i vincoli
di una CA intermedia invece fanno parte della normale verifica del percorso (RFC 5280 §6.1) e valgono sempre.

L'impronta usata dalla Squadriglia (app/squadron.py) resta quella del certificato del SERVER: cambia quando cambia il
certificato (nuovo IP, rinnovo e, una volta sola, il passaggio dal vecchio certificato autofirmato a questo schema).

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
# Certificato del server: Apple accetta al massimo 825 giorni (support.apple.com/en-us/103769: "must have a validity
# period of 825 days or fewer"); lo rigeneriamo 30 giorni prima.
VALID_DAYS = 825
RENEW_DAYS = 30
CA_DAYS = 3650          # CA radice e intermedia: 10 anni (rinnovarle vuol dire installare di nuovo il certificato)
CN = "ED Copilot"
CA_CN = "ED Copilot - CA rete locale"
CA_INT_CN = "ED Copilot - CA intermedia rete locale"
CA_PATH = "/companion-ca.crt"   # indirizzo pubblico (senza codice) del certificato della CA radice, solo la parte pubblica
# Reti private ammesse dai vincoli (RFC 1918 + RFC 6598).
PRIVATE_NETS = tuple(ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"))
DNS_ALLOWED = "invalid"  # RFC 6761 §6.4: dominio riservato, mai risolto su internet


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


def _files(folder=None):
    folder = folder or _dir()
    j = lambda n: os.path.join(folder, n)
    return {"ca": j("ca.crt"), "int": j("ca-int.crt"), "int_key": j("ca-int.key"),
            "cert": j("companion.crt"), "key": j("companion.key"), "chain": j("companion-chain.pem")}


def ip_covered(ip):
    """Vero se l'IP è in una delle reti private ammesse dalla CA (altrimenti il telefono non potrà fidarsi)."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in PRIVATE_NETS)


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _expires(cert):
    try:
        return cert.not_valid_after_utc
    except AttributeError:  # cryptography < 42
        return cert.not_valid_after.replace(tzinfo=datetime.timezone.utc)


def _load_cert(path):
    from cryptography import x509
    with open(path, "rb") as f:
        return x509.load_pem_x509_certificate(f.read())


def _load_key(path):
    from cryptography.hazmat.primitives import serialization
    with open(path, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def _same_key(cert, key):
    from cryptography.hazmat.primitives import serialization
    fmt = (serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return cert.public_key().public_bytes(*fmt) == key.public_key().public_bytes(*fmt)


def _issued_by(cert, issuer):
    try:
        cert.verify_directly_issued_by(issuer)  # cryptography >= 40: nome dell'emittente + firma
        return True
    except Exception:
        return False


def name_constraints():
    from cryptography import x509
    return x509.NameConstraints(
        permitted_subtrees=[x509.IPAddress(n) for n in PRIVATE_NETS] + [x509.DNSName(DNS_ALLOWED)],
        excluded_subtrees=None)


def _write(path, data):
    with open(path, "wb") as f:
        f.write(data)


def _pem(cert):
    from cryptography.hazmat.primitives import serialization
    return cert.public_bytes(serialization.Encoding.PEM)


def _key_pem(key):
    from cryptography.hazmat.primitives import serialization
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def _ca_usage():
    from cryptography import x509
    return x509.KeyUsage(digital_signature=False, key_encipherment=False, content_commitment=False,
                         data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True,
                         encipher_only=False, decipher_only=False)


def _generate_ca(files):
    """Crea radice + intermedia. La chiave della radice resta solo in memoria e viene buttata."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    now = _now()
    end = now + datetime.timedelta(days=CA_DAYS)
    root_key, int_key = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    # Un numero casuale nel nome distingue la CA di questo PC da quella di altri PC (stesso telefono, più PC).
    tag = os.urandom(4).hex().upper()
    root_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"{CA_CN} {tag}"),
                           x509.NameAttribute(NameOID.ORGANIZATION_NAME, CN)])
    int_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"{CA_INT_CN} {tag}"),
                          x509.NameAttribute(NameOID.ORGANIZATION_NAME, CN)])
    root_ski = x509.SubjectKeyIdentifier.from_public_key(root_key.public_key())
    root = (
        x509.CertificateBuilder()
        .subject_name(root_name).issuer_name(root_name)
        .public_key(root_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(end)
        .add_extension(x509.BasicConstraints(ca=True, path_length=1), critical=True)
        .add_extension(_ca_usage(), critical=True)
        .add_extension(name_constraints(), critical=True)
        .add_extension(root_ski, critical=False)
        .sign(root_key, hashes.SHA256())
    )
    inter = (
        x509.CertificateBuilder()
        .subject_name(int_name).issuer_name(root_name)
        .public_key(int_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(end)
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(_ca_usage(), critical=True)
        .add_extension(name_constraints(), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(int_key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(root_ski), critical=False)
        .sign(root_key, hashes.SHA256())
    )
    del root_key  # mai scritta su disco
    _write(files["int_key"], _key_pem(int_key))
    _write(files["int"], _pem(inter))
    _write(files["ca"], _pem(root))
    print(f"[TLS] Nuova CA della rete locale creata in {os.path.dirname(files['ca'])}")


def _ca_ok(files):
    """Radice e intermedia presenti, collegate, con i vincoli, con la chiave giusta e non in scadenza."""
    if not all(os.path.isfile(files[k]) for k in ("ca", "int", "int_key")):
        return False
    try:
        from cryptography import x509
        root, inter, key = _load_cert(files["ca"]), _load_cert(files["int"]), _load_key(files["int_key"])
        for c in (root, inter):
            nc = c.extensions.get_extension_for_class(x509.NameConstraints)
            if not nc.critical or nc.value != name_constraints():
                return False
            if not c.extensions.get_extension_for_class(x509.BasicConstraints).value.ca:
                return False
        fresh = min(_expires(root), _expires(inter)) - _now() > datetime.timedelta(days=RENEW_DAYS)
        return fresh and _issued_by(root, root) and _issued_by(inter, root) and _same_key(inter, key)
    except Exception as exc:
        print(f"[TLS] CA non leggibile, la rigenero: {exc!r}")
        return False


def _cert_ok(files, ip):
    """Vero se il certificato del server esiste, è firmato dall'intermedia attuale, non sta per scadere e contiene
    l'IP attuale. Un vecchio certificato autofirmato (versioni precedenti) non passa e viene sostituito."""
    if not all(os.path.isfile(files[k]) for k in ("cert", "key", "chain")):
        return False
    try:
        from cryptography import x509
        cert, inter = _load_cert(files["cert"]), _load_cert(files["int"])
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        ips = {str(a) for a in san.get_values_for_type(x509.IPAddress)}
        fresh = _expires(cert) - _now() > datetime.timedelta(days=RENEW_DAYS)
        return (fresh and str(ipaddress.ip_address(ip)) in ips and _issued_by(cert, inter)
                and _same_key(cert, _load_key(files["key"])))
    except Exception as exc:
        print(f"[TLS] Certificato non leggibile, lo rigenero: {exc!r}")
        return False


def _generate(files, ip):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    inter, int_key = _load_cert(files["int"]), _load_key(files["int_key"])
    key = ec.generate_private_key(ec.SECP256R1())
    # Solo l'IP della rete locale: niente "localhost"/127.0.0.1, che i vincoli della CA non ammettono (e che al
    # telefono non servono). Gli apparecchi verificano il SAN, non il CN (Apple: "DNS names in the CommonName of a
    # certificate are no longer trusted", support.apple.com/en-us/103769).
    alt = [x509.IPAddress(ipaddress.ip_address(ip or "127.0.0.1"))]
    start = _now() - datetime.timedelta(days=1)  # un giorno di margine per gli orologi indietro
    # Il limite Apple vale per tutto il periodo (da NotBefore a NotAfter), margine compreso.
    end = min(start + datetime.timedelta(days=VALID_DAYS), _expires(inter))
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, CN)]))
        .issuer_name(inter.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(start)
        .not_valid_after(end)
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, key_encipherment=False, content_commitment=False,
                                     data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                     crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
        # Apple: "must contain an ExtendedKeyUsage (EKU) extension containing the id-kp-serverAuth OID" (103769).
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(int_key.public_key()), critical=False)
        .sign(int_key, hashes.SHA256())
    )
    _write(files["key"], _key_pem(key))
    _write(files["cert"], _pem(cert))
    _write(files["chain"], _pem(cert) + _pem(inter))  # inviato al telefono: server + intermedia
    print(f"[TLS] Nuovo certificato per {ip} creato in {os.path.dirname(files['cert'])}")


def ensure_cert(ip, folder=None):
    """Percorsi (catena da inviare, chiave) validi per l'IP dato; crea o rigenera CA e certificato se serve."""
    files = _files(folder)
    if not _ca_ok(files):
        _generate_ca(files)
    if not _cert_ok(files, ip):
        _generate(files, ip)
    return files["chain"], files["key"]


def ca_der(folder=None):
    """Certificato della CA radice in formato DER (solo la parte pubblica: la sua chiave privata non esiste più)."""
    path = _files(folder)["ca"]
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="ascii") as f:
        return ssl.PEM_cert_to_DER_cert(f.read())


def _hex(der):
    digest = hashlib.sha256(der).hexdigest().upper()
    return ":".join(digest[i:i + 2] for i in range(0, len(digest), 2))


def ca_fingerprint(folder=None):
    der = ca_der(folder)
    return _hex(der) if der else None


def fingerprint(cert_path):
    """Impronta SHA-256 del certificato del server (il primo del file), nel formato dei browser (AB:CD:...)."""
    with open(cert_path, "r", encoding="ascii") as f:
        pem = f.read()
    end = "-----END CERTIFICATE-----"
    return _hex(ssl.PEM_cert_to_DER_cert(pem[:pem.index(end) + len(end)] + "\n"))


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
    """Rende HTTPS un ThreadingHTTPServer già creato (prima di serve_forever). Restituisce l'impronta SHA-256
    del certificato del server.

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
    server.tls_fingerprint = fingerprint(cert_path)  # certificato del server: lo usa la Squadriglia (pinning)
    server.tls_ca_fingerprint = ca_fingerprint()     # CA radice: da confrontare quando la si installa sul telefono
    return server.tls_fingerprint
