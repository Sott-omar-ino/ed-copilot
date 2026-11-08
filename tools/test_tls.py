"""Test della CA locale e del certificato HTTPS del companion (app/tls.py).

    python tools/test_tls.py

Lavora solo in cartelle temporanee (non tocca i dati dell'app). Verifica:
- catena radice -> intermedia -> server, con due verificatori indipendenti: quello di cryptography
  (cryptography.x509.verification) e OpenSSL (modulo ssl di Python, con una vera connessione TLS locale);
- vincoli sui nomi presenti e critici in radice e intermedia; SAN del server = solo l'IP della rete locale;
- la chiave della radice non esiste su disco; con la chiave dell'intermedia (quella che resta sul PC) NON si possono
  ottenere certificati validi per IP pubblici, loopback, IPv6 o nomi DNS (es. 8.8.8.8, example.com);
- rigenerazione: stesso IP = stessi certificati; IP nuovo = nuovo certificato del server con la stessa CA;
  vecchio certificato autofirmato (versioni precedenti) e CA rovinata = sostituiti;
- impronta per la Squadriglia = SHA-256 del certificato che il client riceve davvero (pinning, app/squadron.py).
"""

import datetime
import hashlib
import ipaddress
import os
import shutil
import socket
import ssl
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
_TMP = tempfile.mkdtemp(prefix="edc_tls_test_")
os.environ["ED_COPILOT_DATA"] = os.path.join(_TMP, "data")  # app.paths crea le sue cartelle qui, non nei dati veri
from app import tls  # noqa: E402

from cryptography import x509  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID  # noqa: E402
from cryptography.x509.verification import PolicyBuilder, Store, VerificationError  # noqa: E402

passed = failed = 0
LAN_IP = "192.168.1.50"


def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FALLITO:", msg)


def folder(name):
    d = os.path.join(_TMP, name)
    os.makedirs(d, exist_ok=True)
    return d


def verify_crypto(files, leaf, name):
    """Verifica con cryptography: radice come unica fonte di fiducia, intermedia come certificato non attendibile."""
    root, inter = tls._load_cert(files["ca"]), tls._load_cert(files["int"])
    try:
        subject = x509.IPAddress(ipaddress.ip_address(name))
    except ValueError:
        subject = x509.DNSName(name)
    verifier = PolicyBuilder().store(Store([root])).build_server_verifier(subject)
    try:
        verifier.verify(leaf, [inter])
        return True, ""
    except VerificationError as exc:
        return False, str(exc)


def forge_leaf(files, *names):
    """Certificato server firmato con la chiave dell'intermedia (quella salvata sul PC): cosa potrebbe fare chi la ruba."""
    inter, key = tls._load_cert(files["int"]), tls._load_key(files["int_key"])
    leaf_key = ec.generate_private_key(ec.SECP256R1())
    alt = []
    for n in names:
        try:
            alt.append(x509.IPAddress(ipaddress.ip_address(n)))
        except ValueError:
            alt.append(x509.DNSName(n))
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "forged")]))
            .issuer_name(inter.subject).public_key(leaf_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=30))
            .add_extension(x509.SubjectAlternativeName(alt), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(key.public_key()), critical=False)
            .sign(key, hashes.SHA256()))
    return cert, leaf_key


def tls_roundtrip(chain_pem_path, key_path, ca_path, expect_ip):
    """Server TLS locale con la catena data; client OpenSSL che si fida solo della radice e controlla expect_ip.
    Restituisce (ok, impronta SHA-256 del certificato ricevuto senza verifica, errore)."""
    srv_ctx = tls.context(chain_pem_path, key_path)
    lsock = socket.socket()
    lsock.bind(("127.0.0.1", 0))
    lsock.listen(4)
    port = lsock.getsockname()[1]

    def serve():
        for _ in range(2):
            try:
                c, _ = lsock.accept()
                with srv_ctx.wrap_socket(c, server_side=True) as s:
                    s.recv(1)
            except (OSError, ssl.SSLError):
                pass

    t = threading.Thread(target=serve, daemon=True)
    t.start()
    # 1. Come la Squadriglia: nessuna verifica, solo l'impronta.
    pin_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    pin_ctx.check_hostname = False
    pin_ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection(("127.0.0.1", port), timeout=5) as raw, pin_ctx.wrap_socket(raw) as s:
        seen = hashlib.sha256(s.getpeercert(binary_form=True)).hexdigest().upper()
    # 2. Come un telefono che si fida della radice: verifica completa (catena, vincoli, IP).
    ctx = ssl.create_default_context(cafile=ca_path)
    ok, err = True, ""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=5) as raw, ctx.wrap_socket(raw, server_hostname=expect_ip):
            pass
    except ssl.SSLError as exc:
        ok, err = False, str(exc)
    lsock.close()
    t.join(2)
    return ok, ":".join(seen[i:i + 2] for i in range(0, len(seen), 2)), err


def main():
    # --- prima creazione ---------------------------------------------------------------------------------------
    d = folder("fresh")
    chain_path, key_path = tls.ensure_cert(LAN_IP, d)
    files = tls._files(d)
    check(sorted(os.listdir(d)) == sorted(["ca.crt", "ca-int.crt", "ca-int.key", "companion.crt", "companion.key",
                                           "companion-chain.pem"]), f"file creati: {os.listdir(d)}")
    root, inter, leaf = (tls._load_cert(files[k]) for k in ("ca", "int", "cert"))

    # Radice
    check(root.issuer == root.subject and tls._issued_by(root, root), "radice autofirmata")
    bc = root.extensions.get_extension_for_class(x509.BasicConstraints)
    check(bc.critical and bc.value.ca, "radice: BasicConstraints CA critica")
    ku = root.extensions.get_extension_for_class(x509.KeyUsage).value
    check(ku.key_cert_sign and not ku.digital_signature, "radice: KeyUsage solo firma di certificati/CRL")
    for label, cert in (("radice", root), ("intermedia", inter)):
        nc = cert.extensions.get_extension_for_class(x509.NameConstraints)
        check(nc.critical, f"{label}: NameConstraints critica (RFC 5280 4.2.1.10)")
        permitted = {str(g.value) for g in nc.value.permitted_subtrees}
        check(permitted == {"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "invalid"},
              f"{label}: sottoalberi ammessi {permitted}")
        check(nc.value.excluded_subtrees is None, f"{label}: nessun sottoalbero escluso")
        check(isinstance(cert.signature_hash_algorithm, hashes.SHA256), f"{label}: firma SHA-256")
    # Intermedia
    check(tls._issued_by(inter, root), "intermedia firmata dalla radice")
    bc = inter.extensions.get_extension_for_class(x509.BasicConstraints)
    check(bc.critical and bc.value.ca and bc.value.path_length == 0, "intermedia: CA con path_length 0")
    # La chiave della radice non è salvata da nessuna parte: nessuna chiave nella cartella corrisponde alla radice.
    for name in os.listdir(d):
        if name.endswith(".key"):
            check(not tls._same_key(root, tls._load_key(os.path.join(d, name))), f"{name} non è la chiave della radice")

    # Server
    check(tls._issued_by(leaf, inter), "server firmato dall'intermedia")
    san = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    check([str(x) for x in san.get_values_for_type(x509.IPAddress)] == [LAN_IP] and not san.get_values_for_type(x509.DNSName),
          f"SAN del server: solo {LAN_IP}")
    eku = leaf.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    check(ExtendedKeyUsageOID.SERVER_AUTH in eku, "server: EKU serverAuth (requisito Apple)")
    check(not leaf.extensions.get_extension_for_class(x509.BasicConstraints).value.ca, "server: non è una CA")
    span = tls._expires(leaf) - leaf.not_valid_before_utc
    check(span <= datetime.timedelta(days=825), f"server: validità {span} <= 825 giorni (requisito Apple)")
    check(tls._expires(leaf) <= tls._expires(inter), "server: non scade dopo l'intermedia")

    ok, err = verify_crypto(files, leaf, LAN_IP)
    check(ok, f"cryptography: catena valida per {LAN_IP} ({err})")
    ok, _ = verify_crypto(files, leaf, "192.168.1.51")
    check(not ok, "cryptography: il certificato non vale per un altro IP")

    # Certificati falsi firmati con la chiave dell'intermedia: solo le reti private passano.
    good, _ = forge_leaf(files, "10.1.2.3")
    ok, err = verify_crypto(files, good, "10.1.2.3")
    check(ok, f"controllo positivo: certificato per 10.1.2.3 valido ({err})")
    good, _ = forge_leaf(files, "100.100.1.1")
    check(verify_crypto(files, good, "100.100.1.1")[0], "controllo positivo: 100.64.0.0/10 ammessa")
    for name in ("8.8.8.8", "1.1.1.1", "172.32.0.1", "127.0.0.1", "2001:4860:4860::8888", "example.com",
                 "www.google.com", "localhost"):
        bad, _ = forge_leaf(files, name)
        ok, err = verify_crypto(files, bad, name)
        check(not ok, f"cryptography: un certificato per {name} NON deve essere valido")
        check(not ok and "constraint" in err.lower(), f"cryptography: {name} rifiutato per i vincoli sui nomi ({err})")
    # Anche mescolato a un IP privato, un nome pubblico rende il certificato non valido.
    bad, _ = forge_leaf(files, "192.168.1.9", "example.com")
    check(not verify_crypto(files, bad, "192.168.1.9")[0], "cryptography: SAN misto privato+pubblico rifiutato")

    # OpenSSL, connessione TLS vera: catena giusta accettata, impronta = quella della Squadriglia.
    ok, seen_fp, err = tls_roundtrip(chain_path, key_path, files["ca"], LAN_IP)
    check(ok, f"OpenSSL: connessione verificata con la sola radice ({err})")
    check(seen_fp == tls.fingerprint(chain_path), "impronta del certificato ricevuto = tls.fingerprint (pinning Squadriglia)")
    check(tls.fingerprint(chain_path) == tls.fingerprint(files["cert"]), "impronta: stessa dalla catena e dal certificato")
    # OpenSSL con un certificato falso per 8.8.8.8 (firmato dall'intermedia): rifiutato.
    bad, bad_key = forge_leaf(files, "8.8.8.8")
    bad_chain, bad_key_path = os.path.join(_TMP, "bad-chain.pem"), os.path.join(_TMP, "bad.key")
    tls._write(bad_chain, tls._pem(bad) + tls._pem(inter))
    tls._write(bad_key_path, tls._key_pem(bad_key))
    ok, _, err = tls_roundtrip(bad_chain, bad_key_path, files["ca"], "8.8.8.8")
    check(not ok, "OpenSSL: certificato per 8.8.8.8 rifiutato")
    check("subtree" in err.lower() or "constraint" in err.lower(),
          f"OpenSSL: rifiutato per i vincoli sui nomi ({err})")

    # CA pubblica servita al telefono: DER della radice, nient'altro.
    der = tls.ca_der(d)
    check(der == root.public_bytes(serialization.Encoding.DER), "ca_der = radice in DER")
    check(b"PRIVATE" not in der, "ca_der senza chiavi")
    check(tls.ca_fingerprint(d) == ":".join(hashlib.sha256(der).hexdigest().upper()[i:i + 2] for i in range(0, 64, 2)),
          "ca_fingerprint")

    # --- rigenerazione ---------------------------------------------------------------------------------------------
    fp_leaf, fp_ca = tls.fingerprint(chain_path), tls.ca_fingerprint(d)
    tls.ensure_cert(LAN_IP, d)
    check(tls.fingerprint(chain_path) == fp_leaf and tls.ca_fingerprint(d) == fp_ca, "stesso IP: nulla cambia")
    tls.ensure_cert("10.0.0.7", d)
    check(tls.fingerprint(chain_path) != fp_leaf, "IP nuovo: nuovo certificato del server")
    check(tls.ca_fingerprint(d) == fp_ca, "IP nuovo: la CA (già installata sul telefono) resta la stessa")
    check(verify_crypto(files, tls._load_cert(files["cert"]), "10.0.0.7")[0], "IP nuovo: catena valida")
    check(tls.ip_covered("192.168.0.10") and tls.ip_covered("100.64.0.1") and not tls.ip_covered("8.8.8.8")
          and not tls.ip_covered("127.0.0.1") and not tls.ip_covered("x"), "ip_covered")

    # --- aggiornamento da una versione precedente (certificato autofirmato) --------------------------------------
    old = folder("upgrade")
    files_old = tls._files(old)
    k = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "ED Copilot")])
    now = datetime.datetime.now(datetime.timezone.utc)
    selfsigned = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(k.public_key())
                  .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
                  .not_valid_after(now + datetime.timedelta(days=825))
                  .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(LAN_IP)),
                                                               x509.DNSName("localhost")]), critical=False)
                  .sign(k, hashes.SHA256()))
    tls._write(files_old["cert"], tls._pem(selfsigned))
    tls._write(files_old["key"], tls._key_pem(k))
    old_fp = tls.fingerprint(files_old["cert"])
    chain_old, _ = tls.ensure_cert(LAN_IP, old)
    new_leaf = tls._load_cert(files_old["cert"])
    check(tls._issued_by(new_leaf, tls._load_cert(files_old["int"])), "aggiornamento: vecchio autofirmato sostituito")
    check(tls.fingerprint(chain_old) != old_fp, "aggiornamento: l'impronta cambia (la Squadriglia chiede un codice nuovo)")
    check(verify_crypto(files_old, new_leaf, LAN_IP)[0], "aggiornamento: catena valida")

    # --- CA rovinata: rigenerata (e con lei il certificato del server) --------------------------------------------
    with open(files_old["ca"], "wb") as f:
        f.write(b"not a certificate")
    tls.ensure_cert(LAN_IP, old)
    check(verify_crypto(files_old, tls._load_cert(files_old["cert"]), LAN_IP)[0], "CA rovinata: rigenerata, catena valida")

    print(f"{passed} controlli superati, {failed} falliti")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        code = main()
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
    sys.exit(code)
