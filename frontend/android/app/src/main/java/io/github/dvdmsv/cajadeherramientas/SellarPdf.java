package io.github.dvdmsv.cajadeherramientas;

import com.tom_roush.pdfbox.pdmodel.*;
import com.tom_roush.pdfbox.cos.*;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.*;
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.*;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDSignatureField;
import org.bouncycastle.asn1.*;
import org.bouncycastle.asn1.cms.*;
import org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaCertStore;
import org.bouncycastle.cms.*;
import org.bouncycastle.cms.jcajce.*;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.*;
import org.bouncycastle.tsp.*;
import java.io.*;
import java.net.*;
import java.math.BigInteger;
import java.security.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

final class SellarPdf {
    static void comprobar(AtomicBoolean cancelado) throws IOException {if(cancelado.get())throw new IOException("Operación cancelada.");}
    static TimeStampToken tiempo(byte[] hash,AtomicBoolean cancelado) throws Exception {
        comprobar(cancelado);
        TimeStampRequestGenerator gen=new TimeStampRequestGenerator();gen.setCertReq(true);
        TimeStampRequest request=gen.generate(TSPAlgorithms.SHA256,hash,new BigInteger(128,new SecureRandom()));
        HttpURLConnection connection=(HttpURLConnection)new URL("https://freetsa.org/tsr").openConnection();
        connection.setConnectTimeout(5000);connection.setReadTimeout(10000);connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/timestamp-query");
        connection.setRequestProperty("Accept","application/timestamp-reply");
        try {
            byte[] body=request.getEncoded();connection.setFixedLengthStreamingMode(body.length);
            try(OutputStream out=connection.getOutputStream()){out.write(body);}
            comprobar(cancelado);
            if(connection.getResponseCode()!=200)throw new IOException("La autoridad de tiempo no ha aceptado la solicitud.");
            ByteArrayOutputStream response=new ByteArrayOutputStream();
            try(InputStream in=connection.getInputStream()) {
                byte[] b=new byte[8192];int n;
                while((n=in.read(b))!=-1){comprobar(cancelado);if(response.size()+n>1024*1024)throw new IOException("La respuesta de tiempo es demasiado grande.");response.write(b,0,n);}
            }
            TimeStampResponse parsed=new TimeStampResponse(response.toByteArray());parsed.validate(request);
            TimeStampToken token=parsed.getTimeStampToken();
            if(token==null||parsed.getFailInfo()!=null)throw new IOException("La autoridad de tiempo no ha emitido un sello.");
            Collection<X509CertificateHolder> certs=token.getCertificates().getMatches(token.getSID());
            if(certs.isEmpty())throw new IOException("El sello no incluye su certificado.");
            token.validate(new JcaSimpleSignerInfoVerifierBuilder().setProvider(FirmasPdf.BC).build(certs.iterator().next()));
            comprobar(cancelado);return token;
        }finally{connection.disconnect();}
    }
    static byte[] firmarCms(InputStream input,FirmasPdf.Identidad identidad,boolean conTiempo,AtomicBoolean cancelado) throws Exception {
        String type=identidad.clave.getAlgorithm();
        String alg=type.equalsIgnoreCase("EC")?"SHA256withECDSA":type.equalsIgnoreCase("DSA")?"SHA256withDSA":type.equalsIgnoreCase("RSA")?"SHA256withRSA":null;
        if(alg==null)throw new IOException("El algoritmo del certificado no está admitido.");
        ContentSigner signer=new JcaContentSignerBuilder(alg).build(identidad.clave);
        CMSSignedDataGenerator gen=new CMSSignedDataGenerator();
        gen.addSignerInfoGenerator(new JcaSignerInfoGeneratorBuilder(new JcaDigestCalculatorProviderBuilder().setProvider(FirmasPdf.BC).build()).build(signer,identidad.cadena[0]));
        gen.addCertificates(new JcaCertStore(Arrays.asList(identidad.cadena)));
        CMSTypedData data=new CMSTypedData(){
            public ASN1ObjectIdentifier getContentType(){return PKCSObjectIdentifiers.data;}
            public Object getContent(){return input;}
            public void write(OutputStream out)throws IOException {byte[] b=new byte[8192];int n;while((n=input.read(b))!=-1){comprobar(cancelado);out.write(b,0,n);}}
        };
        CMSSignedData cms=gen.generate(data,false);
        if(conTiempo) {
            List<SignerInformation> signers=new ArrayList<>();
            for(SignerInformation info:cms.getSignerInfos().getSigners()) {
                TimeStampToken token=tiempo(MessageDigest.getInstance("SHA-256").digest(info.getSignature()),cancelado);
                ASN1EncodableVector attributes=new ASN1EncodableVector();
                attributes.add(new Attribute(PKCSObjectIdentifiers.id_aa_signatureTimeStampToken,new DERSet(ASN1Primitive.fromByteArray(token.getEncoded()))));
                signers.add(SignerInformation.replaceUnsignedAttributes(info,new AttributeTable(attributes)));
            }
            cms=CMSSignedData.replaceSigners(cms,new SignerInformationStore(signers));
        }
        return cms.getEncoded();
    }
    static void ejecutar(File entrada,File salida,FirmasPdf.Identidad identidad,boolean sello,boolean conTiempo,
                         String motivo,String lugar,int pagina,float[] rect,byte[] png,AtomicBoolean cancelado)throws Exception {
        comprobar(cancelado);
        if(entrada.length()==0||entrada.length()>50L*1024*1024)throw new IOException("Selecciona un PDF de hasta 50 MB.");
        try(PDDocument doc=PDDocument.load(entrada);SignatureOptions options=new SignatureOptions()) {
            if(doc.isEncrypted()||doc.getNumberOfPages()==0)throw new IOException("El PDF está protegido o vacío.");
            CertificacionPdf.comprobar(doc,entrada);
            COSBase perms=doc.getDocumentCatalog().getCOSObject().getDictionaryObject(COSName.PERMS);
            if(perms instanceof COSDictionary) {
                COSBase mdp=((COSDictionary)perms).getDictionaryObject(COSName.DOCMDP);
                if(mdp instanceof COSDictionary) {
                    COSBase refs=((COSDictionary)mdp).getDictionaryObject(COSName.REFERENCE);
                    if(refs instanceof COSArray)for(COSBase ref:(COSArray)refs) {
                        COSBase value=ref instanceof COSObject?((COSObject)ref).getObject():ref;
                        if(value instanceof COSDictionary) {
                            COSBase params=((COSDictionary)value).getDictionaryObject(COSName.TRANSFORM_PARAMS);
                            if(params instanceof COSDictionary&&((COSDictionary)params).getInt(COSName.P,2)==1)throw new IOException("Las restricciones de este PDF no permiten añadir la firma o el sello.");
                        }
                    }
                }
            }
            PDSignature sig=new PDSignature();sig.setFilter(PDSignature.FILTER_ADOBE_PPKLITE);
            sig.setSubFilter(sello?COSName.getPDFName("ETSI.RFC3161"):PDSignature.SUBFILTER_ETSI_CADES_DETACHED);
            sig.getCOSObject().setName(COSName.TYPE,sello?"DocTimeStamp":"Sig");sig.setSignDate(Calendar.getInstance());
            if(!sello){sig.setName(FirmasPdf.comun(identidad.cadena[0].getSubjectX500Principal()));sig.setReason(motivo);sig.setLocation(lugar);}
            options.setPreferredSignatureSize(256*1024);
            if(pagina<0||pagina>=doc.getNumberOfPages())throw new IOException("La página de firma no existe.");
            options.setPage(pagina);
            doc.addSignature(sig,input->{
                try {
                    if(!sello)return firmarCms(input,identidad,conTiempo,cancelado);
                    MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] b=new byte[8192];int n;
                    while((n=input.read(b))!=-1){comprobar(cancelado);digest.update(b,0,n);}
                    return tiempo(digest.digest(),cancelado).getEncoded();
                }catch(Exception e){throw new IOException("No se ha podido firmar o sellar el PDF: "+e.getMessage(),e);}
            },options);
            if(!sello&&rect!=null&&png!=null) {
                for(float f:rect)if(!Float.isFinite(f))throw new IOException("El recuadro no es válido.");
                if(rect.length!=4||rect[2]<=rect[0]||rect[3]<=rect[1]||png.length>10*1024*1024)throw new IOException("La apariencia no es válida.");
                PDSignatureField field=null;
                for(PDSignatureField f:doc.getSignatureFields())if(f.getSignature()!=null&&f.getSignature().getCOSObject()==sig.getCOSObject()){field=f;break;}
                if(field==null)throw new IOException("No se ha podido crear el campo de firma.");
                PDAnnotationWidget widget=field.getWidgets().get(0);PDPage page=doc.getPage(pagina);
                PDRectangle box=new PDRectangle(rect[0],rect[1],rect[2]-rect[0],rect[3]-rect[1]);
                widget.setRectangle(box);widget.setPage(page);widget.setPrinted(true);
                // addSignature sin plantilla visual no enlaza el widget a /Annots.
                // /P en el widget no basta para que los lectores lo representen.
                java.util.List<com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation> annotations=new java.util.ArrayList<>(page.getAnnotations());
                boolean presente=false;
                for(com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation a:annotations)if(a.getCOSObject()==widget.getCOSObject())presente=true;
                if(!presente)annotations.add(widget);
                page.setAnnotations(annotations);
                PDAppearanceStream appearance=new PDAppearanceStream(doc);appearance.setResources(new PDResources());appearance.setBBox(new PDRectangle(box.getWidth(),box.getHeight()));
                try(PDPageContentStream stream=new PDPageContentStream(doc,appearance)) {
                    stream.drawImage(PDImageXObject.createFromByteArray(doc,png,"apariencia"),0,0,box.getWidth(),box.getHeight());
                }
                PDAppearanceDictionary dictionary=new PDAppearanceDictionary();dictionary.setNormalAppearance(appearance);widget.setAppearance(dictionary);
                widget.getCOSObject().setNeedToBeUpdated(true);field.getCOSObject().setNeedToBeUpdated(true);page.getCOSObject().setNeedToBeUpdated(true);
            }
            comprobar(cancelado);
            try(OutputStream out=new FileOutputStream(salida)){doc.saveIncremental(out);}
            comprobar(cancelado);
            if(salida.length()>250L*1024*1024)throw new IOException("El resultado supera 250 MB.");
        }catch(Exception e){salida.delete();throw e;}
    }
}
