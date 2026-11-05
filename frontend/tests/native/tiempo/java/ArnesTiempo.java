package io.github.dvdmsv.cajadeherramientas;
import java.io.*;import java.net.*;import java.nio.file.*;import java.security.*;import java.math.BigInteger;import java.util.*;import java.util.concurrent.atomic.AtomicBoolean;
import com.tom_roush.pdfbox.pdmodel.*;import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.*;
import org.bouncycastle.asn1.*;import org.bouncycastle.asn1.x500.X500Name;import org.bouncycastle.asn1.x509.*;import org.bouncycastle.cert.*;import org.bouncycastle.cert.jcajce.*;import org.bouncycastle.cms.*;import org.bouncycastle.cms.jcajce.*;import org.bouncycastle.operator.jcajce.*;import org.bouncycastle.tsp.*;import org.bouncycastle.util.io.pem.*;
public class ArnesTiempo {
 static int checks=0,calls=0,failures=0;static String mode="ok";static byte[] lastBody;static X509CertificateHolder certificate;static KeyPair keys;
 static void check(boolean b,String msg){if(!b)throw new AssertionError(msg);checks++;System.out.println("PASS "+msg);}
 static void rejected(String modeName)throws Exception {mode=modeName;try{SellarPdf.tiempo(new byte[32],new AtomicBoolean());throw new AssertionError("Acepta "+modeName);}catch(IOException|TSPException|org.bouncycastle.cms.CMSException e){checks++;System.out.println("PASS rechaza "+modeName+" "+e.getClass().getSimpleName());}}
 static byte[] response(byte[] body)throws Exception {
  TimeStampRequest req=new TimeStampRequest(body);lastBody=body;
  check(req.getMessageImprintAlgOID().equals(TSPAlgorithms.SHA256),"request SHA256");check(req.getNonce()!=null&&req.getNonce().bitLength()<=128,"request nonce");check(req.getCertReq(),"request certificado");check(body.length<200,"sólo huella y datos RFC3161");
  if(mode.equals("nonce")||mode.equals("hash")){TimeStampRequestGenerator g=new TimeStampRequestGenerator();g.setCertReq(true);byte[] h=req.getMessageImprintDigest().clone();if(mode.equals("hash"))h[0]^=1;req=g.generate(TSPAlgorithms.SHA256,h,req.getNonce().add(mode.equals("nonce")?BigInteger.ONE:BigInteger.ZERO));}
  var signer=new JcaContentSignerBuilder("SHA256withRSA").setProvider(FirmasPdf.BC).build(keys.getPrivate());
  var digests=new JcaDigestCalculatorProviderBuilder().setProvider(FirmasPdf.BC).build();
  var si=new JcaSignerInfoGeneratorBuilder(digests).build(signer,certificate);
  var generator=new TimeStampTokenGenerator(si,digests.get(new AlgorithmIdentifier(new ASN1ObjectIdentifier("1.3.14.3.2.26"))),new ASN1ObjectIdentifier("1.2.3.4.1"));
  if(!mode.equals("sin-cert"))generator.addCertificates(new org.bouncycastle.util.CollectionStore<X509CertificateHolder>(List.of(certificate)));
  var gen=new TimeStampResponseGenerator(generator,TSPAlgorithms.ALLOWED);
  byte[] out=gen.generateGrantedResponse(req,BigInteger.valueOf(System.nanoTime()),new Date()).getEncoded();
  if(mode.equals("alterado"))out[out.length-10]^=1;
  return out;
 }
 static class Mock extends HttpURLConnection {
  ByteArrayOutputStream request=new ByteArrayOutputStream();Mock(URL url){super(url);calls++;}
  public void disconnect(){}public boolean usingProxy(){return false;}public void connect(){}
  public OutputStream getOutputStream(){return request;}
  public int getResponseCode(){return mode.equals("http")?503:mode.equals("redirect")?302:200;}
  public InputStream getInputStream()throws IOException {
   check(getConnectTimeout()==5000&&getReadTimeout()==10000,"timeouts 5s/10s");check(!getInstanceFollowRedirects(),"sin redirección");check("POST".equals(getRequestMethod()),"POST");check("application/timestamp-query".equals(getRequestProperty("Content-Type")),"tipo consulta");
   if(mode.equals("grande"))return new ByteArrayInputStream(new byte[1024*1024+1]);
   try{return new ByteArrayInputStream(response(request.toByteArray()));}catch(Exception e){throw new IOException(e);}
  }
 }
 static void verify(File file,int count)throws Exception {
  byte[] all=Files.readAllBytes(file.toPath());try(PDDocument doc=PDDocument.load(file)){
   check(doc.getSignatureDictionaries().size()==count,"número de sellos "+count);
   for(PDSignature sig:doc.getSignatureDictionaries()){
    check("ETSI.RFC3161".equals(sig.getSubFilter()),"subfilter RFC3161");check("DocTimeStamp".equals(sig.getCOSObject().getNameAsString(com.tom_roush.pdfbox.cos.COSName.TYPE)),"tipo DocTimeStamp");
    byte[] encoded=sig.getContents(all),signed=sig.getSignedContent(all);TimeStampToken token=new TimeStampToken(new CMSSignedData(encoded));
    token.validate(new JcaSimpleSignerInfoVerifierBuilder().setProvider(FirmasPdf.BC).build(certificate));
    check(Arrays.equals(token.getTimeStampInfo().getMessageImprintDigest(),MessageDigest.getInstance("SHA-256").digest(signed)),"digest ByteRange íntegro");
    Files.write(Path.of("auditoria/ultimo-token.tst"),token.getEncoded());Files.write(Path.of("auditoria/ultimo-contenido.bin"),signed);
   }
  }
 }
 public static void main(String[]args)throws Exception {
  URL.setURLStreamHandlerFactory(protocol->protocol.equals("https")?new URLStreamHandler(){protected URLConnection openConnection(URL u){check("https://freetsa.org/tsr".equals(u.toString()),"URL TSA HTTPS fija");return new Mock(u);}}:null);
  KeyPairGenerator kp=KeyPairGenerator.getInstance("RSA");kp.initialize(2048);keys=kp.generateKeyPair();X500Name name=new X500Name("CN=TSA de prueba offline");
  var builder=new JcaX509v3CertificateBuilder(name,BigInteger.ONE,new Date(System.currentTimeMillis()-86400000),new Date(System.currentTimeMillis()+86400000),name,keys.getPublic());
  builder.addExtension(Extension.extendedKeyUsage,true,new ExtendedKeyUsage(KeyPurposeId.id_kp_timeStamping));builder.addExtension(Extension.keyUsage,true,new KeyUsage(KeyUsage.digitalSignature));builder.addExtension(Extension.basicConstraints,true,new BasicConstraints(false));
  certificate=builder.build(new JcaContentSignerBuilder("SHA256withRSA").build(keys.getPrivate()));
  try(PemWriter writer=new PemWriter(new FileWriter("auditoria/tsa.pem"))){writer.writeObject(new PemObject("CERTIFICATE",certificate.getEncoded()));}
  byte[] hash=MessageDigest.getInstance("SHA-256").digest("documento artificial".getBytes());var token=SellarPdf.tiempo(hash,new AtomicBoolean());check(Arrays.equals(hash,token.getTimeStampInfo().getMessageImprintDigest()),"huella devuelta exacta");
  int before=calls;try{SellarPdf.tiempo(hash,new AtomicBoolean(true));throw new AssertionError("No cancela");}catch(IOException ok){check(calls==before,"cancelación no consulta TSA");}
  for(String s:new String[]{"nonce","hash","sin-cert","alterado","http","redirect","grande"})rejected(s);
  mode="ok";File original=new File("auditoria/base.pdf");try(PDDocument doc=new PDDocument()){doc.addPage(new PDPage());doc.save(original);}
  File out=new File("auditoria/sello.pdf");SellarPdf.ejecutar(original,out,null,true,false,"","",0,null,null,new AtomicBoolean());verify(out,1);
  byte[] source=Files.readAllBytes(original.toPath()),result=Files.readAllBytes(out.toPath());check(Arrays.equals(source,Arrays.copyOf(result,source.length)),"revisión incremental conserva original");
  File second=new File("auditoria/dos-sellos.pdf");SellarPdf.ejecutar(out,second,null,true,false,"","",0,null,null,new AtomicBoolean());verify(second,2);
  check(Arrays.equals(result,Arrays.copyOf(Files.readAllBytes(second.toPath()),result.length)),"segunda revisión conserva primer sello");
  mode="http";File failure=new File("auditoria/fallo.pdf");try{SellarPdf.ejecutar(original,failure,null,true,false,"","",0,null,null,new AtomicBoolean());throw new AssertionError("No rechaza fallo TSA");}catch(IOException ok){check(!failure.exists(),"fallo TSA elimina PDF parcial y no sustituye por fecha visible");}
  mode="ok";
  for(String line:Files.readAllLines(Path.of("auditoria/matriz-base.log"))) {
   String[] parts=line.split(" ");if(parts.length!=3)continue;String fixtureName=parts[0];boolean expected=parts[2].equals("True") || fixtureName.equals("p3-annotation");File in=new File("auditoria/"+fixtureName+".pdf");int requests=calls;
   try {SellarPdf.ejecutar(in,new File("auditoria/"+fixtureName+"-sellada.pdf"),null,true,false,"","",0,null,null,new AtomicBoolean());if(!expected)failures++;System.out.println((expected?"PASS":"FAIL")+" MATRIZ "+fixtureName+" aceptada consultasTSA="+(calls-requests));}
   catch(Exception e){if(expected||calls!=requests)failures++;System.out.println((!expected&&calls==requests?"PASS":"FAIL")+" MATRIZ "+fixtureName+" rechazada consultasTSA="+(calls-requests)+" "+e.getMessage());}
  }
  System.out.println("TOTAL CONTROLES "+checks+"; CASOS FALLIDOS "+failures);if(failures>0)System.exit(1);
 }
}
