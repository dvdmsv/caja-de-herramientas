package io.github.dvdmsv.cajadeherramientas;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.PDSignature;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDSignatureField;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cms.*;
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.tsp.TimeStampToken;
import org.json.*;
import java.io.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Validación criptográfica sin raíces de confianza ni consultas de red. */
final class FirmasPdf {
    static final Provider BC=new BouncyCastleProvider();
    static String fecha(Date date) {
        if(date==null)return null;
        SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX",Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));return f.format(date);
    }
    static String comun(javax.security.auth.x500.X500Principal principal) {
        org.bouncycastle.asn1.x500.X500Name name=org.bouncycastle.asn1.x500.X500Name.getInstance(principal.getEncoded());
        org.bouncycastle.asn1.x500.RDN[] cn=name.getRDNs(org.bouncycastle.asn1.x500.style.BCStyle.CN);
        return cn.length>0?org.bouncycastle.asn1.x500.style.IETFUtils.valueToString(cn[0].getFirst().getValue()):principal.getName();
    }
    static boolean autofirmado(X509Certificate cert) {
        if(!cert.getIssuerX500Principal().equals(cert.getSubjectX500Principal()))return false;
        try{cert.verify(cert.getPublicKey(),BC);return true;}catch(Exception e){return false;}
    }
    static JSONObject certificado(X509Certificate c) throws JSONException {
        Date now=new Date();return new JSONObject().put("nombre",comun(c.getSubjectX500Principal()))
            .put("emisor",comun(c.getIssuerX500Principal())).put("desde",fecha(c.getNotBefore())).put("hasta",fecha(c.getNotAfter()))
            .put("caducado",c.getNotAfter().before(now)).put("todavia_no",c.getNotBefore().after(now)).put("autofirmado",autofirmado(c));
    }
    static final class Identidad {
        final PrivateKey clave;final X509Certificate[] cadena;
        Identidad(PrivateKey clave,X509Certificate[] cadena){this.clave=clave;this.cadena=cadena;}
    }
    static Identidad abrir(byte[] p12,char[] password) throws IOException {
        try {
            if(p12.length==0||p12.length>256*1024)throw new IOException();
            KeyStore store=KeyStore.getInstance("PKCS12",BC);store.load(new ByteArrayInputStream(p12),password);
            for(Enumeration<String> en=store.aliases();en.hasMoreElements();) {
                String alias=en.nextElement();if(!store.isKeyEntry(alias))continue;
                Key key=store.getKey(alias,password);if(!(key instanceof PrivateKey))continue;
                java.security.cert.Certificate[] chain=store.getCertificateChain(alias);
                if(chain==null||chain.length==0)continue;
                X509Certificate[] certs=Arrays.copyOf(chain,chain.length,X509Certificate[].class);
                return new Identidad((PrivateKey)key,certs);
            }
        }catch(Exception ignored){}finally{Arrays.fill(password,'\0');Arrays.fill(p12,(byte)0);}
        throw new IOException("No se ha podido abrir el certificado. Comprueba la contraseña y el archivo .p12 o .pfx.");
    }
    static JSONArray inspeccionar(File file,AtomicBoolean cancelado) throws Exception {
        if(file.length()>50L*1024*1024)throw new IOException("El PDF supera 50 MB.");
        byte[] bytes=java.nio.file.Files.readAllBytes(file.toPath());
        try(PDDocument doc=PDDocument.load(bytes)) {
            if(doc.isEncrypted())throw new IOException("Quita la contraseña del PDF antes de comprobarlo.");
            JSONArray result=new JSONArray();
            for(PDSignature sig:doc.getSignatureDictionaries()) {
                if(cancelado.get())throw new IOException("Operación cancelada.");
                String campo="Firma";
                for(PDSignatureField field:doc.getSignatureFields())if(field.getSignature()!=null&&field.getSignature().getCOSObject().equals(sig.getCOSObject())){campo=field.getFullyQualifiedName();break;}
                result.put(resumen(sig,campo,bytes));
            }
            return result;
        }
    }
    private static JSONObject resumen(PDSignature sig,String campo,byte[] bytes) throws Exception {
        boolean sello="ETSI.RFC3161".equals(sig.getSubFilter());
        JSONObject r=new JSONObject().put("campo",campo).put("tipo",sello?"sello_tiempo":"firma")
            .put("firmante",sig.getName()==null?"Firmante desconocido":sig.getName()).put("emisor","desconocido")
            .put("autofirmado",false).put("fecha",sig.getSignDate()==null?JSONObject.NULL:fecha(sig.getSignDate().getTime()))
            .put("sello_tiempo",JSONObject.NULL).put("intacta",JSONObject.NULL).put("cobertura","desconocida")
            .put("cambios",JSONObject.NULL).put("vigente_al_firmar",JSONObject.NULL).put("error",JSONObject.NULL);
        try {
            int[] range=sig.getByteRange();
            if(range==null||range.length!=4||range[0]!=0||range[1]<0||range[2]<=range[1]||range[3]<0||(long)range[2]+range[3]>bytes.length)throw new IOException("El rango de bytes de la firma no es válido.");
            byte[] contents=sig.getContents(bytes),signed=sig.getSignedContent(bytes);
            CMSSignedData cms=sello?new CMSSignedData(contents):new CMSSignedData(new CMSProcessableByteArray(signed),contents);
            Collection<SignerInformation> signers=cms.getSignerInfos().getSigners();
            if(signers.size()!=1)throw new IOException("El contenedor debe identificar un firmante.");
            SignerInformation signer=signers.iterator().next();
            Collection<X509CertificateHolder> holders=cms.getCertificates().getMatches(signer.getSID());
            if(holders.isEmpty())throw new IOException("Falta el certificado del firmante.");
            X509CertificateHolder holder=holders.iterator().next();
            X509Certificate cert=new JcaX509CertificateConverter().setProvider(BC).getCertificate(holder);
            // La integridad CMS y la vigencia son resultados independientes.
            // RFC3161 sí necesita certificado asociado para validar ESS/EKU.
            SignerInformationVerifier verifier=sello?new JcaSimpleSignerInfoVerifierBuilder().setProvider(BC).build(holder):new JcaSimpleSignerInfoVerifierBuilder().setProvider(BC).build(cert.getPublicKey());
            Date when=sig.getSignDate()==null?null:sig.getSignDate().getTime();
            boolean intacta;
            if(sello) {
                TimeStampToken token=new TimeStampToken(cms);token.validate(verifier);when=token.getTimeStampInfo().getGenTime();
                byte[] digest=MessageDigest.getInstance(token.getTimeStampInfo().getMessageImprintAlgOID().getId(),BC).digest(signed);
                intacta=MessageDigest.isEqual(digest,token.getTimeStampInfo().getMessageImprintDigest());
                r.put("sello_tiempo",fecha(when));r.put("fecha",fecha(when));
            } else {
                try{intacta=signer.verify(verifier);}
                catch(CMSSignerDigestMismatchException e){intacta=false;}
                org.bouncycastle.asn1.cms.Attribute time=signer.getSignedAttributes()==null?null:signer.getSignedAttributes().get(org.bouncycastle.asn1.cms.CMSAttributes.signingTime);
                if(time!=null)when=org.bouncycastle.asn1.cms.Time.getInstance(time.getAttrValues().getObjectAt(0)).getDate();
                org.bouncycastle.asn1.cms.Attribute timestamp=signer.getUnsignedAttributes()==null?null:signer.getUnsignedAttributes().get(org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers.id_aa_signatureTimeStampToken);
                if(timestamp!=null) {
                    TimeStampToken token=new TimeStampToken(new CMSSignedData(timestamp.getAttrValues().getObjectAt(0).toASN1Primitive().getEncoded()));
                    Collection<X509CertificateHolder> tsCerts=token.getCertificates().getMatches(token.getSID());
                    if(tsCerts.isEmpty())throw new IOException("Falta el certificado del sello de tiempo.");
                    token.validate(new JcaSimpleSignerInfoVerifierBuilder().setProvider(BC).build(tsCerts.iterator().next()));
                    byte[] digest=MessageDigest.getInstance(token.getTimeStampInfo().getMessageImprintAlgOID().getId(),BC).digest(signer.getSignature());
                    if(!MessageDigest.isEqual(digest,token.getTimeStampInfo().getMessageImprintDigest()))throw new IOException("El sello de tiempo no corresponde a esta firma.");
                    r.put("sello_tiempo",fecha(token.getTimeStampInfo().getGenTime()));
                }
                r.put("fecha",when==null?JSONObject.NULL:fecha(when));
            }
            long end=(long)range[2]+range[3];
            boolean gap=range[2]-range[1]>=2&&bytes[range[1]]=='<'&&bytes[range[2]-1]=='>';
            for(int i=range[1]+1;gap&&i<range[2]-1;i++){int c=bytes[i]&255;if(Character.digit((char)c,16)<0&&!Character.isWhitespace(c))gap=false;}
            String antes=new String(bytes,Math.max(0,range[1]-64),Math.min(64,range[1]),java.nio.charset.StandardCharsets.ISO_8859_1);
            gap=gap&&antes.matches("(?s).*?/Contents\\s*$");
            String fin=new String(bytes,Math.max(0,(int)end-40),Math.min(40,(int)end),java.nio.charset.StandardCharsets.ISO_8859_1);
            String cobertura=gap?(end==bytes.length?"todo":fin.matches("(?s).*%%EOF\\s*")?"revision":"parcial"):"parcial";
            r.put("firmante",comun(cert.getSubjectX500Principal())).put("emisor",comun(cert.getIssuerX500Principal()))
                .put("autofirmado",autofirmado(cert)).put("intacta",intacta).put("cobertura",cobertura)
                .put("cambios",end==bytes.length?"nada":"cambios desconocidos")
                .put("vigente_al_firmar",when==null?JSONObject.NULL:!when.before(cert.getNotBefore())&&!when.after(cert.getNotAfter()));
        }catch(Exception e){r.put("error","No se ha podido comprobar esta firma: "+e.getMessage());}
        return r;
    }
}
