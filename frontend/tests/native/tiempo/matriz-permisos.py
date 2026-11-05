from pathlib import Path
from datetime import datetime,timedelta,timezone
from io import BytesIO
from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from asn1crypto import x509 as ax,keys
from pyhanko.sign import signers,fields
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko_certvalidator.registry import SimpleCertificateStore
import fitz
out=Path('auditoria');now=datetime.now(timezone.utc)
key=rsa.generate_private_key(public_exponent=65537,key_size=2048);name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Certificador de prueba')]);cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.BasicConstraints(ca=False,path_length=None),True).sign(key,hashes.SHA256());a=ax.Certificate.load(cert.public_bytes(serialization.Encoding.DER));k=keys.PrivateKeyInfo.load(key.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));signer=signers.SimpleSigner(a,k,SimpleCertificateStore())
from pyhanko.pdf_utils import generic as g
import logging
logging.disable(logging.CRITICAL)
def dictionary(**kw):return g.DictionaryObject({g.NameObject('/'+k):v for k,v in kw.items()})
doc=fitz.open();doc.new_page();base=doc.tobytes();doc.close()
w=IncrementalPdfFileWriter(BytesIO(base));page_ref,res=w.find_page_for_modification(0);page=page_ref.get_object()
field=w.add_object(dictionary(Type=g.NameObject('/Annot'),Subtype=g.NameObject('/Widget'),FT=g.NameObject('/Tx'),T=g.TextStringObject('Nombre'),V=g.TextStringObject('Original'),Rect=g.ArrayObject(map(g.NumberObject,[20,20,180,50])),P=page_ref,F=g.NumberObject(4),DA=g.TextStringObject('/Helv 10 Tf 0 g')))
font=w.add_object(dictionary(Type=g.NameObject('/Font'),Subtype=g.NameObject('/Type1'),BaseFont=g.NameObject('/Helvetica')))
w.root[g.NameObject('/AcroForm')]=w.add_object(dictionary(Fields=g.ArrayObject([field]),DA=g.TextStringObject('/Helv 10 Tf 0 g'),DR=dictionary(Font=dictionary(Helv=font)),NeedAppearances=g.BooleanObject(True)))
page[g.NameObject('/Annots')]=g.ArrayObject([field]);w.mark_update(page_ref);w.update_root();dest=BytesIO();w.write(dest);base=dest.getvalue()
def sign(data,name,perm=None,lock=False):
 w=IncrementalPdfFileWriter(BytesIO(data));meta=signers.PdfSignatureMetadata(field_name=name,certify=perm is not None,docmdp_permissions=perm or fields.MDPPerm.FILL_FORMS)
 spec=fields.SigFieldSpec(name,field_mdp_spec=(lock if isinstance(lock,fields.FieldMDPSpec) else fields.FieldMDPSpec(action=fields.FieldMDPAction.ALL))) if lock else None
 d=BytesIO();signers.sign_pdf(w,meta,signer=signer,new_field_spec=spec,output=d);return d.getvalue()
def mutate(data,kind):
 w=IncrementalPdfFileWriter(BytesIO(data));ref,res=w.find_page_for_modification(0);p=ref.get_object()
 if kind=='content':p[g.NameObject('/Contents')]=w.add_object(g.StreamObject(stream_data=b'q 1 0 0 rg 20 20 80 80 re f Q'));w.mark_update(ref)
 if kind=='resources':p[g.NameObject('/Resources')]=dictionary(Font=dictionary(Extra=w.add_object(dictionary(Type=g.NameObject('/Font'),Subtype=g.NameObject('/Type1'),BaseFont=g.NameObject('/Courier')))));w.mark_update(ref)
 if kind=='form':
  f=w.root['/AcroForm']['/Fields'].raw_get(0);obj=f.get_object();obj[g.NameObject('/V')]=g.TextStringObject('Modificado');w.mark_update(f)
 if kind=='annotation':
  p['/Annots'].append(w.add_object(dictionary(Type=g.NameObject('/Annot'),Subtype=g.NameObject('/Text'),Rect=g.ArrayObject(map(g.NumberObject,[200,200,220,220])),Contents=g.TextStringObject('Nota permitida'),P=ref)));w.mark_update(ref)
 d=BytesIO();w.write(d);return d.getvalue()
fixtures={}
for p,permission in [('p2',fields.MDPPerm.FILL_FORMS),('p3',fields.MDPPerm.ANNOTATE)]:
 original=sign(base,'Certificacion',permission);fixtures[p+'-original']=original;fixtures[p+'-segunda']=sign(original,'Segunda')
 for kind in ['content','resources','form','annotation']:fixtures[p+'-'+kind]=mutate(original,kind)
locked=sign(base,'Certificacion',fields.MDPPerm.FILL_FORMS,True);fixtures['p2-locked-form']=mutate(locked,'form')
for label,action,selected in [('include-nombre',fields.FieldMDPAction.INCLUDE,['Nombre']),('include-otro',fields.FieldMDPAction.INCLUDE,['Otro']),('exclude-nombre',fields.FieldMDPAction.EXCLUDE,['Nombre']),('exclude-otro',fields.FieldMDPAction.EXCLUDE,['Otro'])]:
 locked=sign(base,'Certificacion',fields.MDPPerm.FILL_FORMS,fields.FieldMDPSpec(action=action,fields=selected));fixtures['p2-'+label]=mutate(locked,'form')
for name,data in fixtures.items():
 (out/(name+'.pdf')).write_bytes(data);r=PdfFileReader(BytesIO(data));sig=r.embedded_signatures[0];sig.compute_integrity_info();print(name,'docmdp_ok',sig.summarise_integrity_info()['docmdp_ok'])
