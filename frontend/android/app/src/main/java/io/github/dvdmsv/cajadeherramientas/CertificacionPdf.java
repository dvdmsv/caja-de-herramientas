package io.github.dvdmsv.cajadeherramientas;
import com.tom_roush.pdfbox.cos.*;
import com.tom_roush.pdfbox.pdmodel.*;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation;
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.PDSignature;
import com.tom_roush.pdfbox.pdmodel.interactive.form.*;
import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;

/** Compara las revisiones certificadas antes de permitir otra firma o una TSA. */
final class CertificacionPdf {
    private static Set<String> set(String... names){return new HashSet<>(Arrays.asList(names));}
    static void comprobar(PDDocument actual,File entrada)throws Exception {
        for(PDSignature signature:actual.getSignatureDictionaries()) {
            COSBase refs=signature.getCOSObject().getDictionaryObject(COSName.REFERENCE);
            if(!(refs instanceof COSArray))continue;
            for(COSBase ref:(COSArray)refs) {
                COSBase object=ref instanceof COSObject?((COSObject)ref).getObject():ref;
                if(!(object instanceof COSDictionary))continue;
                COSDictionary transform=(COSDictionary)object;
                String metodo=transform.getNameAsString(COSName.TRANSFORM_METHOD);
                if(!"DocMDP".equals(metodo)&&!"FieldMDP".equals(metodo))continue;
                COSBase params=transform.getDictionaryObject(COSName.TRANSFORM_PARAMS);
                int permiso=params instanceof COSDictionary?((COSDictionary)params).getInt(COSName.P,2):2;
                int[] range=signature.getByteRange();
                if(range==null||range.length!=4||range[0]!=0||range[1]<0||range[2]<=range[1]||range[3]<0)rechazar();
                long end=(long)range[2]+range[3];if(end>entrada.length()||end<=0)rechazar();
                if(end==entrada.length())continue;
                byte[] revision=Arrays.copyOf(Files.readAllBytes(entrada.toPath()),(int)end);
                try(PDDocument antes=PDDocument.load(revision)) {
                    if("FieldMDP".equals(metodo)) {
                        if(!(params instanceof COSDictionary))rechazar();
                        COSDictionary restricciones=(COSDictionary)params;
                        String accion=restricciones.getNameAsString(COSName.getPDFName("Action"),"All");
                        if(!set("All","Include","Exclude").contains(accion))rechazar();
                        Set<String> nombres=new HashSet<>();
                        COSBase seleccion=restricciones.getDictionaryObject(COSName.FIELDS);
                        if(seleccion instanceof COSArray)for(COSBase campo:(COSArray)seleccion) {
                            COSBase valor=campo instanceof COSObject?((COSObject)campo).getObject():campo;
                            if(valor instanceof COSString)nombres.add(((COSString)valor).getString());
                        }
                        Map<String,PDField> anteriores=campos(antes),actuales=campos(actual);
                        for(Map.Entry<String,PDField> campo:anteriores.entrySet()) {
                            boolean incluido=false;
                            for(String nombre:nombres)if(campo.getKey().equals(nombre)||campo.getKey().startsWith(nombre+"."))incluido=true;
                            boolean bloqueado="All".equals(accion)||("Include".equals(accion)?incluido:!incluido);
                            if(bloqueado) {
                                PDField nuevo=actuales.get(campo.getKey());
                                if(nuevo==null||!Arrays.equals(hash(campo.getValue().getCOSObject(),set("P")),hash(nuevo.getCOSObject(),set("P"))))rechazar();
                            }
                        }
                        continue;
                    }
                    if(antes.getNumberOfPages()!=actual.getNumberOfPages())rechazar();
                    for(int n=0;n<antes.getNumberOfPages();n++) {
                        PDPage a=antes.getPage(n),b=actual.getPage(n);
                        if(!a.getMediaBox().toString().equals(b.getMediaBox().toString())||!a.getCropBox().toString().equals(b.getCropBox().toString())||a.getRotation()!=b.getRotation())rechazar();
                        if(!Arrays.equals(hash(a.getCOSObject().getDictionaryObject(COSName.CONTENTS),set()),hash(b.getCOSObject().getDictionaryObject(COSName.CONTENTS),set())))rechazar();
                        if(!Arrays.equals(hash(a.getResources()==null?null:a.getResources().getCOSObject(),set()),hash(b.getResources()==null?null:b.getResources().getCOSObject(),set())))rechazar();
                        if(permiso<3) {
                            List<PDAnnotation> aa=new ArrayList<>(),bb=new ArrayList<>();
                            for(PDAnnotation v:a.getAnnotations())if(!"Widget".equals(v.getSubtype()))aa.add(v);
                            for(PDAnnotation v:b.getAnnotations())if(!"Widget".equals(v.getSubtype()))bb.add(v);
                            if(aa.size()!=bb.size())rechazar();
                            for(int j=0;j<aa.size();j++)if(!Arrays.equals(hash(aa.get(j).getCOSObject(),set("P")),hash(bb.get(j).getCOSObject(),set("P"))))rechazar();
                        }
                    }
                    Set<String> catalogo=set("Pages","AcroForm","DSS","Extensions","Version");
                    if(!Arrays.equals(hash(antes.getDocumentCatalog().getCOSObject(),catalogo),hash(actual.getDocumentCatalog().getCOSObject(),catalogo)))rechazar();
                    Map<String,PDField> prev=campos(antes),now=campos(actual);
                    for(Map.Entry<String,PDField> old:prev.entrySet()) {
                        PDField current=now.get(old.getKey());if(current==null)rechazar();
                        if(!Arrays.equals(hash(old.getValue().getCOSObject(),set("V","AP","AS","P")),hash(current.getCOSObject(),set("V","AP","AS","P"))))rechazar();
                    }
                    for(Map.Entry<String,PDField> current:now.entrySet())if(!prev.containsKey(current.getKey())&&!(current.getValue() instanceof PDSignatureField))rechazar();
                }
            }
        }
    }
    private static Map<String,PDField> campos(PDDocument doc) {
        Map<String,PDField> fields=new TreeMap<>();PDAcroForm form=doc.getDocumentCatalog().getAcroForm();
        if(form!=null)for(PDField f:form.getFieldTree())fields.put(f.getFullyQualifiedName(),f);return fields;
    }
    private static void rechazar()throws IOException {throw new IOException("La certificación anterior del PDF no permite los cambios que contiene. No se ha consultado a la autoridad de tiempo.");}
    private static byte[] hash(COSBase value,Set<String> ignorar)throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");long[] limite={0,0};
        visitar(value,ignorar,digest,new IdentityHashMap<>(),0,limite);return digest.digest();
    }
    private static void token(MessageDigest d,String s){d.update(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));d.update((byte)0);}
    private static void visitar(COSBase value,Set<String> ignorar,MessageDigest digest,IdentityHashMap<COSBase,Boolean> camino,int depth,long[] limite)throws Exception {
        if(++limite[0]>500000||depth>100)throw new IOException("El PDF es demasiado complejo para comprobar sus restricciones.");
        if(value instanceof COSObject)value=((COSObject)value).getObject();
        if(value==null){token(digest,"null");return;}
        if(camino.put(value,true)!=null){token(digest,"cycle");return;}
        try {
            if(value instanceof COSDictionary) {
                COSDictionary dict=(COSDictionary)value;token(digest,value instanceof COSStream?"stream":"dict");
                List<COSName> keys=new ArrayList<>(dict.keySet());keys.sort(Comparator.comparing(COSName::getName));
                for(COSName key:keys) {
                    String name=key.getName();
                    // /Data en SigRef apunta al catálogo vivo, no al valor del campo.
                    if(name.equals("Data")&&set("DocMDP","FieldMDP").contains(dict.getNameAsString(COSName.TRANSFORM_METHOD)))continue;
                    if(name.equals("Parent")||ignorar.contains(name)||(value instanceof COSStream&&set("Length","Filter","DecodeParms").contains(name)))continue;
                    token(digest,name);visitar(dict.getDictionaryObject(key),ignorar,digest,camino,depth+1,limite);
                }
                if(value instanceof COSStream)try(InputStream in=((COSStream)value).createInputStream()) {
                    byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){limite[1]+=n;if(limite[1]>250L*1024*1024)throw new IOException("El contenido descomprimido supera 250 MB.");digest.update(b,0,n);}
                }
            } else if(value instanceof COSArray){token(digest,"array");for(COSBase v:(COSArray)value)visitar(v,ignorar,digest,camino,depth+1,limite);}
            else if(value instanceof COSString){token(digest,"string");digest.update(((COSString)value).getBytes());}
            else token(digest,value.toString());
        }finally{camino.remove(value);}
    }
}
