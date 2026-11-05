package io.github.dvdmsv.cajadeherramientas;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.security.KeyStore;
import java.security.cert.X509Certificate;

public class CertificadosTest {
    @Test public void certificadoInteroperable() throws Exception {
        char[] clave = "Password123!".toCharArray();
        var r = Certificados.crear("José García", "Equipo", "jose@example.com", "ES", 3, 2048, clave);
        // El proveedor estándar de Java abre el PKCS12 generado por Bouncy Castle.
        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(new ByteArrayInputStream(r.p12),clave);
        String alias = ks.aliases().nextElement();
        assertNotNull(ks.getKey(alias,clave));
        X509Certificate cert = (X509Certificate)ks.getCertificate(alias);
        cert.checkValidity(); cert.verify(cert.getPublicKey());
        assertEquals(-1,cert.getBasicConstraints());
        assertTrue(cert.getKeyUsage()[0]); assertTrue(cert.getKeyUsage()[1]);
        assertTrue(cert.getSubjectX500Principal().getName().contains("José García"));
        assertArrayEquals(r.crt,cert.getEncoded());
        try { ks.load(new ByteArrayInputStream(r.p12),"incorrecta".toCharArray()); fail("Contraseña incorrecta aceptada"); }
        catch(java.io.IOException expected) {}
    }
    @Test public void contrasenaUnicode() throws Exception {
        char[] clave = "Contraseña123!".toCharArray();
        var r = Certificados.crear("José", "", "", "ES", 1, 2048, clave);
        KeyStore ks = KeyStore.getInstance("PKCS12",new org.bouncycastle.jce.provider.BouncyCastleProvider());
        ks.load(new ByteArrayInputStream(r.p12),clave);
        assertNotNull(ks.getKey(ks.aliases().nextElement(),clave));
    }
    @Test(expected=IllegalArgumentException.class) public void claveCorta() throws Exception {
        Certificados.crear("Nombre","","","ES",3,2048,"123".toCharArray());
    }
}
