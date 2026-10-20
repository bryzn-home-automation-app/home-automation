package com.homeplatform.push;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigInteger;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;

/**
 * Web Push message encryption (RFC 8291, "aes128gcm" content coding per RFC 8188) and
 * VAPID request signing (RFC 8292), on the JDK's own crypto — no extra dependencies.
 * Everything here is pure and deterministic given its inputs (salt and ephemeral key
 * pair are parameters), so tests can decrypt what it produces like a browser would.
 */
public final class WebPushCrypto {

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();
    private static final SecureRandom RANDOM = new SecureRandom();
    /** One record holds the whole (small) payload. */
    static final int RECORD_SIZE = 4096;

    private WebPushCrypto() {}

    // ── keys ──

    public static KeyPair newKeyPair() {
        try {
            KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
            g.initialize(new ECGenParameterSpec("secp256r1"));
            return g.generateKeyPair();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("P-256 unavailable", e);
        }
    }

    /** Uncompressed point 0x04 || X || Y (65 bytes) — the format browsers use. */
    public static byte[] encodePoint(ECPublicKey key) {
        byte[] out = new byte[65];
        out[0] = 0x04;
        copyFixed(key.getW().getAffineX(), out, 1);
        copyFixed(key.getW().getAffineY(), out, 33);
        return out;
    }

    public static ECPublicKey decodePoint(byte[] point) {
        if (point.length != 65 || point[0] != 0x04) throw new IllegalArgumentException("Not an uncompressed P-256 point");
        try {
            ECParameterSpec params = ((ECPublicKey) newKeyPair().getPublic()).getParams();
            ECPoint w = new ECPoint(new BigInteger(1, Arrays.copyOfRange(point, 1, 33)),
                    new BigInteger(1, Arrays.copyOfRange(point, 33, 65)));
            return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(w, params));
        } catch (GeneralSecurityException e) {
            throw new IllegalArgumentException("Invalid P-256 point", e);
        }
    }

    public static PrivateKey decodePrivate(byte[] pkcs8) {
        try {
            return KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
        } catch (GeneralSecurityException e) {
            throw new IllegalArgumentException("Invalid EC private key", e);
        }
    }

    public static String b64(byte[] b) { return B64.encodeToString(b); }

    public static byte[] unb64(String s) { return B64D.decode(s.trim()); }

    // ── RFC 8291 encryption ──

    /** Encrypt {@code plaintext} for a subscription's p256dh key and auth secret. */
    public static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return encrypt(plaintext, uaPublic, authSecret, salt, newKeyPair());
    }

    static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret, byte[] salt, KeyPair asKeys) {
        try {
            byte[] asPublic = encodePoint((ECPublicKey) asKeys.getPublic());
            KeyAgreement ka = KeyAgreement.getInstance("ECDH");
            ka.init(asKeys.getPrivate());
            ka.doPhase(decodePoint(uaPublic), true);
            byte[] ecdhSecret = ka.generateSecret();

            byte[] keyInfo = concat("WebPush: info\0".getBytes(StandardCharsets.US_ASCII), uaPublic, asPublic);
            byte[] ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
            byte[] cek = hkdf(salt, ikm, "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII), 16);
            byte[] nonce = hkdf(salt, ikm, "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII), 12);

            // Single (last) record: payload || 0x02 delimiter, no extra padding.
            byte[] padded = Arrays.copyOf(plaintext, plaintext.length + 1);
            padded[plaintext.length] = 0x02;
            if (padded.length + 16 > RECORD_SIZE) throw new IllegalArgumentException("Push payload too large");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
            byte[] ciphertext = c.doFinal(padded);

            ByteBuffer header = ByteBuffer.allocate(16 + 4 + 1 + asPublic.length);
            header.put(salt).putInt(RECORD_SIZE).put((byte) asPublic.length).put(asPublic);
            return concat(header.array(), ciphertext);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Push encryption failed", e);
        }
    }

    /** HKDF-SHA256 (extract then expand), for outputs up to 32 bytes. */
    static byte[] hkdf(byte[] salt, byte[] ikm, byte[] info, int length) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(info);
        mac.update((byte) 1);
        return Arrays.copyOf(mac.doFinal(), length);
    }

    // ── RFC 8292 VAPID ──

    /**
     * The {@code Authorization} header value for a push to {@code endpoint}:
     * {@code vapid t=<ES256 JWT>, k=<public key>}. The audience is the push service's
     * origin (e.g. https://web.push.apple.com).
     */
    public static String vapidAuthorization(String endpoint, String subject, ECPublicKey publicKey,
                                            PrivateKey privateKey, long nowEpochSeconds) {
        URI u = URI.create(endpoint);
        String aud = u.getScheme() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
        String header = b64("{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8));
        String claims = b64(("{\"aud\":\"" + aud + "\",\"exp\":" + (nowEpochSeconds + 12 * 3600)
                + ",\"sub\":\"" + subject + "\"}").getBytes(StandardCharsets.UTF_8));
        String signingInput = header + "." + claims;
        try {
            // P1363 = raw R || S (32 bytes each), the JWS ES256 format; plain
            // SHA256withECDSA would give DER, which push services reject.
            Signature s = Signature.getInstance("SHA256withECDSAinP1363Format");
            s.initSign(privateKey);
            s.update(signingInput.getBytes(StandardCharsets.US_ASCII));
            String jwt = signingInput + "." + b64(s.sign());
            return "vapid t=" + jwt + ", k=" + b64(encodePoint(publicKey));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("VAPID signing failed", e);
        }
    }

    // ── helpers ──

    /** Big-endian, left-padded/trimmed to 32 bytes. */
    private static void copyFixed(BigInteger v, byte[] out, int offset) {
        byte[] b = v.toByteArray();
        int len = Math.min(b.length, 32);
        System.arraycopy(b, b.length - len, out, offset + 32 - len, len);
    }

    static byte[] concat(byte[]... parts) {
        int n = 0;
        for (byte[] p : parts) n += p.length;
        byte[] out = new byte[n];
        int o = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, o, p.length);
            o += p.length;
        }
        return out;
    }
}
