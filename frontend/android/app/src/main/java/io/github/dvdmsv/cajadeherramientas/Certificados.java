package io.github.dvdmsv.cajadeherramientas;

import org.bouncycastle.asn1.DERBMPString;
import org.bouncycastle.asn1.nist.NISTObjectIdentifiers;
import org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers;
import org.bouncycastle.cert.jcajce.JcaX509ExtensionUtils;
import org.bouncycastle.pkcs.PKCS12PfxPduBuilder;
import org.bouncycastle.pkcs.jcajce.JcaPKCS12SafeBagBuilder;
import org.bouncycastle.pkcs.jcajce.JcePKCSPBEOutputEncryptorBuilder;
import org.bouncycastle.pkcs.jcajce.JcePKCS12MacCalculatorBuilder;
import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Date;
import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.asn1.x500.X500NameBuilder;
import org.bouncycastle.asn1.x500.style.BCStyle;
import org.bouncycastle.asn1.x509.BasicConstraints;
import org.bouncycastle.asn1.x509.ExtendedKeyUsage;
import org.bouncycastle.asn1.x509.Extension;
import org.bouncycastle.asn1.x509.KeyPurposeId;
import org.bouncycastle.asn1.x509.KeyUsage;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;

/** No escribe claves privadas en disco ni usa el proveedor BC antiguo de Android. */
public final class Certificados {
    private Certificados() {}
    public static final class Resultado {
        public final byte[] p12;
        public final byte[] crt;
        Resultado(byte[] p12, byte[] crt) { this.p12 = p12; this.crt = crt; }
    }
    public static Resultado crear(String nombre, String organizacion, String correo, String pais,
                                  int anos, int bits, char[] password) throws Exception {
        nombre = campo(nombre); organizacion = campo(organizacion); correo = campo(correo); pais = campo(pais);
        if (nombre.isEmpty()) throw new IllegalArgumentException("Escribe el nombre del certificado.");
        if (anos < 1 || anos > 10 || (bits != 2048 && bits != 4096)) throw new IllegalArgumentException("La vigencia o el tamaño de clave no son válidos.");
        if (password.length < 8) throw new IllegalArgumentException("La contraseña necesita al menos 8 caracteres.");
        pais = pais.isEmpty() ? "ES" : pais.toUpperCase(java.util.Locale.ROOT);
        if (pais.length() > 2) pais = pais.substring(0,2);
        X500NameBuilder sujeto = new X500NameBuilder(BCStyle.INSTANCE).addRDN(BCStyle.CN,nombre);
        if (!organizacion.isEmpty()) sujeto.addRDN(BCStyle.O,organizacion);
        if (!correo.isEmpty()) sujeto.addRDN(BCStyle.EmailAddress,correo);
        if (pais.matches("[A-Z]{2}")) sujeto.addRDN(BCStyle.C,pais);
        X500Name name = sujeto.build();
        SecureRandom random = new SecureRandom();
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(bits,random);
        KeyPair pair = generator.generateKeyPair();
        long now = System.currentTimeMillis();
        BigInteger serial;
        do { serial = new BigInteger(159,random); } while(serial.signum() == 0);
        BouncyCastleProvider provider = new BouncyCastleProvider();
        var builder = new JcaX509v3CertificateBuilder(name,serial,new Date(now-86400000L),
            new Date(now+365L*anos*86400000L),name,pair.getPublic());
        builder.addExtension(Extension.basicConstraints,true,new BasicConstraints(false));
        builder.addExtension(Extension.keyUsage,true,new KeyUsage(KeyUsage.digitalSignature|KeyUsage.nonRepudiation));
        builder.addExtension(Extension.extendedKeyUsage,false,new ExtendedKeyUsage(KeyPurposeId.id_kp_emailProtection));
        X509Certificate cert = new JcaX509CertificateConverter().setProvider(provider).getCertificate(
            builder.build(new JcaContentSignerBuilder("SHA256withRSA").setProvider(provider).build(pair.getPrivate())));
        cert.verify(pair.getPublic());
        var keyId = new JcaX509ExtensionUtils().createSubjectKeyIdentifier(pair.getPublic());
        var encryptor = new JcePKCSPBEOutputEncryptorBuilder(NISTObjectIdentifiers.id_aes256_CBC)
            .setProvider(provider).setIterationCount(100000).build(password);
        var keyBag = new JcaPKCS12SafeBagBuilder(pair.getPrivate(),encryptor);
        keyBag.addBagAttribute(PKCSObjectIdentifiers.pkcs_9_at_friendlyName,new DERBMPString("certificado"));
        keyBag.addBagAttribute(PKCSObjectIdentifiers.pkcs_9_at_localKeyId,keyId);
        var certBag = new JcaPKCS12SafeBagBuilder(cert);
        certBag.addBagAttribute(PKCSObjectIdentifiers.pkcs_9_at_friendlyName,new DERBMPString("certificado"));
        certBag.addBagAttribute(PKCSObjectIdentifiers.pkcs_9_at_localKeyId,keyId);
        var pfx = new PKCS12PfxPduBuilder();
        pfx.addData(keyBag.build());
        pfx.addEncryptedData(new JcePKCSPBEOutputEncryptorBuilder(NISTObjectIdentifiers.id_aes256_CBC)
            .setProvider(provider).setIterationCount(100000).build(password),certBag.build());
        byte[] p12 = pfx.build(new JcePKCS12MacCalculatorBuilder(NISTObjectIdentifiers.id_sha256)
            .setProvider(provider).setIterationCount(100000),password).getEncoded();
        return new Resultado(p12,cert.getEncoded());
    }
    private static String campo(String value) {
        String s = (value == null ? "" : value).replaceAll("[\\x00-\\x1f\\x7f]"," ").trim();
        if(s.length()>100) throw new IllegalArgumentException("Los campos no pueden superar 100 caracteres.");
        return s;
    }
}
