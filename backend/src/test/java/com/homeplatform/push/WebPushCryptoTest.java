package com.homeplatform.push;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECPrivateKeySpec;
import java.util.Arrays;

import static com.homeplatform.push.WebPushCrypto.*;
import static org.junit.jupiter.api.Assertions.*;

class WebPushCryptoTest {

    private static PrivateKey privateFromScalar(byte[] d) throws Exception {
        var params = ((ECPublicKey) newKeyPair().getPublic()).getParams();
        return KeyFactory.getInstance("EC").generatePrivate(new ECPrivateKeySpec(new BigInteger(1, d), params));
    }

    /** What a browser does with a push body (RFC 8291 §3.4 + RFC 8188), using the subscription's private key. */
    private static byte[] decrypt(byte[] body, PrivateKey uaPrivate, byte[] uaPublic, byte[] auth) throws Exception {
        ByteBuffer b = ByteBuffer.wrap(body);
        byte[] salt = new byte[16];
        b.get(salt);
        int rs = b.getInt();
        assertEquals(RECORD_SIZE, rs);
        byte[] asPublic = new byte[b.get()];
        b.get(asPublic);
        byte[] ciphertext = new byte[b.remaining()];
        b.get(ciphertext);

        KeyAgreement ka = KeyAgreement.getInstance("ECDH");
        ka.init(uaPrivate);
        ka.doPhase(decodePoint(asPublic), true);
        byte[] ikm = hkdf(auth, ka.generateSecret(),
                concat("WebPush: info\0".getBytes(StandardCharsets.US_ASCII), uaPublic, asPublic), 32);
        byte[] cek = hkdf(salt, ikm, "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII), 16);
        byte[] nonce = hkdf(salt, ikm, "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII), 12);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        byte[] padded = c.doFinal(ciphertext);
        assertEquals(0x02, padded[padded.length - 1], "last-record delimiter");
        return Arrays.copyOf(padded, padded.length - 1);
    }

    @Test
    @DisplayName("RFC 8291 Appendix A: the published example encrypts byte-for-byte")
    void rfcExample() throws Exception {
        byte[] plaintext = unb64("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24");
        byte[] asPublic = unb64("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
        byte[] asPrivate = unb64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
        byte[] uaPublic = unb64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
        byte[] salt = unb64("DGv6ra1nlYgDCS1FRnbzlw");
        byte[] auth = unb64("BTBZMqHH6r4Tts7J_aSIgg");
        KeyPair as = new KeyPair(decodePoint(asPublic), privateFromScalar(asPrivate));

        byte[] body = WebPushCrypto.encrypt(plaintext, uaPublic, auth, salt, as);

        assertEquals("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
                b64(body));
    }

    @Test
    @DisplayName("round trip: a browser holding the subscription keys decrypts the payload")
    void roundTrip() throws Exception {
        KeyPair ua = newKeyPair();
        byte[] uaPublic = encodePoint((ECPublicKey) ua.getPublic());
        byte[] auth = new byte[16];
        new java.security.SecureRandom().nextBytes(auth);
        byte[] msg = "{\"title\":\"Person detected — Front\",\"url\":\"/cameras\"}".getBytes(StandardCharsets.UTF_8);

        byte[] body = WebPushCrypto.encrypt(msg, uaPublic, auth);

        assertArrayEquals(msg, decrypt(body, ua.getPrivate(), uaPublic, auth));
    }

    @Test
    @DisplayName("VAPID header: ES256 JWT for the push service's origin, verifiable with the public key")
    void vapid() throws Exception {
        KeyPair kp = newKeyPair();
        long now = 1_792_520_000L;
        String header = vapidAuthorization("https://web.push.apple.com/QGuQyavXutnMH8hFvd7/abc", "https://homeos.local",
                (ECPublicKey) kp.getPublic(), kp.getPrivate(), now);

        assertTrue(header.startsWith("vapid t="));
        String jwt = header.substring("vapid t=".length(), header.indexOf(", k="));
        String k = header.substring(header.indexOf(", k=") + 4);
        assertEquals(b64(encodePoint((ECPublicKey) kp.getPublic())), k);

        String[] parts = jwt.split("\\.");
        String claims = new String(unb64(parts[1]), StandardCharsets.UTF_8);
        assertTrue(claims.contains("\"aud\":\"https://web.push.apple.com\""), claims);
        assertTrue(claims.contains("\"exp\":" + (now + 12 * 3600)));
        assertTrue(claims.contains("\"sub\":\"https://homeos.local\""));
        byte[] sig = unb64(parts[2]);
        assertEquals(64, sig.length, "raw R||S, not DER");
        Signature v = Signature.getInstance("SHA256withECDSAinP1363Format");
        v.initVerify(kp.getPublic());
        v.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        assertTrue(v.verify(sig));
    }

    @Test
    @DisplayName("keys survive encode/decode")
    void keyEncoding() {
        KeyPair kp = newKeyPair();
        byte[] point = encodePoint((ECPublicKey) kp.getPublic());
        assertEquals(65, point.length);
        assertEquals(kp.getPublic(), decodePoint(point));
        assertEquals(kp.getPrivate(), decodePrivate(kp.getPrivate().getEncoded()));
        assertThrows(IllegalArgumentException.class, () -> decodePoint(new byte[64]));
    }
}
