#include <exiv2/exiv2.hpp>
#include "json.hpp"
#include <fstream>
#include <map>
#include <set>
#include <iostream>
#include <sys/resource.h>
#include <sys/prctl.h>
#include <signal.h>
using json=nlohmann::json;
static const std::map<uint16_t,std::string> etiquetas={
 {0x010f,"Marca de la cámara"},{0x0110,"Modelo de la cámara"},{0xa434,"Objetivo"},
 {0x0131,"Software"},{0x0132,"Fecha"},{0x9003,"Fecha de la toma"},{0x013b,"Autor"},
 {0x8298,"Copyright"},{0x013c,"Equipo"},{0xa431,"Número de serie"}};
static json bloque(const std::string& key,const std::string& label,const std::string& value){return {{"clave",key},{"etiqueta",label},{"valor",value},{"texto",""},{"editable",false}};}
static std::vector<unsigned char> leer(const std::string& path){std::ifstream in(path,std::ios::binary);return {std::istreambuf_iterator<char>(in),{}};}
static void escribir(const std::string& path,const std::vector<unsigned char>& bytes){std::ofstream out(path,std::ios::binary);out.write(reinterpret_cast<const char*>(bytes.data()),bytes.size());if(!out)throw std::runtime_error("No se puede guardar la imagen.");}
static bool elegido(const json& o,const std::string& key){auto s=o.value("seleccion",json(nullptr));return s.is_null()||(s.is_array()&&std::find(s.begin(),s.end(),key)!=s.end());}
static void informe(const std::string& path,const json& report){std::ofstream out(path);out<<report.dump(-1,' ',false,json::error_handler_t::replace);if(!out)throw std::runtime_error("No se puede guardar el informe.");}
int main(int argc,char** argv) {
 if(argc!=5)return 2;
 prctl(PR_SET_PDEATHSIG,SIGKILL);
 rlimit cpu{120,121},size{250ULL*1024*1024,250ULL*1024*1024};setrlimit(RLIMIT_CPU,&cpu);setrlimit(RLIMIT_FSIZE,&size);
 try {
  json options;std::ifstream settings(argv[3]);settings>>options;
  auto raw=leer(argv[1]);if(raw.empty()||raw.size()>50ULL*1024*1024)throw std::runtime_error("La imagen supera 50 MB o está vacía.");
  const bool inspeccionar=options.value("inspeccionar",false);
  const auto selected=options.value("seleccion",json(nullptr)),changes=options.value("cambios",json::object());
  if(!selected.is_null()&&!selected.is_array())throw std::runtime_error("La selección no es válida.");
  if(!changes.is_object())throw std::runtime_error("Los cambios no son válidos.");
  const bool noop=selected.is_array()&&selected.empty()&&changes.empty();
  // Los bloques de imagen GIF se copian literalmente, incluyendo todos los frames.
  if(raw.size()>=13&&std::string(raw.begin(),raw.begin()+3)=="GIF") {
   if(!changes.empty())throw std::runtime_error("Los datos de GIF no son editables.");
   size_t pos=13+((raw[10]&128)?3ULL*(1ULL<<((raw[10]&7)+1)):0);
   if(pos>raw.size())throw std::runtime_error("El GIF está dañado.");
   std::vector<unsigned char> output(raw.begin(),raw.begin()+pos);json report={{"campos",json::array()},{"ubicacion",false},{"mime","image/gif"}};
   bool comentario=false,xmp=false,fin=false;
   auto bloques=[&](){while(true){if(pos>=raw.size())throw std::runtime_error("El GIF está truncado.");size_t n=raw[pos++];if(!n)break;if(n>raw.size()-pos)throw std::runtime_error("El GIF está truncado.");pos+=n;}};
   while(pos<raw.size()) {
    const size_t start=pos;unsigned char tipo=raw[pos++];bool quitar=false;
    if(tipo==0x3b){output.insert(output.end(),raw.begin()+start,raw.end());fin=true;break;}
    if(tipo==0x21) {
     if(pos>=raw.size())throw std::runtime_error("El GIF está truncado.");auto etiqueta=raw[pos++];
     if(etiqueta==0xfe){comentario=true;quitar=elegido(options,"comentario");}
     if(etiqueta==0xff&&pos+12<=raw.size()&&raw[pos]==11&&std::string(raw.begin()+pos+1,raw.begin()+pos+12)=="XMP DataXMP"){xmp=true;quitar=elegido(options,"xmp");}
     bloques();
    }else if(tipo==0x2c) {
     if(pos+9>raw.size())throw std::runtime_error("El GIF está truncado.");auto packed=raw[pos+8];pos+=9;
     if(packed&128)pos+=3ULL*(1ULL<<((packed&7)+1));
     if(pos>=raw.size())throw std::runtime_error("El GIF está truncado.");pos++;bloques();
    }else throw std::runtime_error("El GIF está dañado.");
    if(!quitar||noop||inspeccionar)output.insert(output.end(),raw.begin()+start,raw.begin()+pos);
   }
   if(!fin)throw std::runtime_error("El GIF está truncado.");
   if(comentario)report["campos"].push_back(bloque("comentario","Comentario","un bloque incrustado en el archivo"));
   if(xmp)report["campos"].push_back(bloque("xmp","Metadatos XMP","un bloque incrustado en el archivo"));
   if(!inspeccionar)escribir(argv[2],output);informe(argv[4],report);return 0;
  }
  // ICO puede contener varios PNG y DIB. Se conservan todas las entradas.
  if(raw.size()>=6&&raw[0]==0&&raw[1]==0&&raw[2]==1&&raw[3]==0) {
   size_t count=raw[4]+256U*raw[5];if(count==0||count>256||6+16*count>raw.size())throw std::runtime_error("El icono está dañado.");
   auto u32=[&](size_t p){return uint32_t(raw[p])|(uint32_t(raw[p+1])<<8)|(uint32_t(raw[p+2])<<16)|(uint32_t(raw[p+3])<<24);};
   std::vector<unsigned char> output(raw.begin(),raw.begin()+6+16*count);json report={{"campos",json::array()},{"ubicacion",false},{"mime","image/x-icon"}};std::set<std::string> keys;
   for(size_t i=0;i<count;i++) {
    size_t entry=6+i*16,len=u32(entry+8),offset=u32(entry+12);
    if(offset<6+16*count||offset>raw.size()||len>raw.size()-offset)throw std::runtime_error("El icono está dañado.");
    std::vector<unsigned char> part(raw.begin()+offset,raw.begin()+offset+len);
    if(part.size()>=8&&part[0]==137&&part[1]==80&&part[2]==78&&part[3]==71) {
     std::string in=std::string(argv[2])+"-ico-"+std::to_string(i)+".png",out=in+".out",meta=in+".json";escribir(in,part);
     char* args[]={argv[0],in.data(),out.data(),argv[3],meta.data()};
     if(main(5,args)!=0)throw std::runtime_error("No se pueden procesar los metadatos del icono.");
     json child;std::ifstream m(meta);m>>child;
     if(child.value("ubicacion",false))report["ubicacion"]=true;
     for(const auto& campo:child["campos"])if(keys.insert(campo["clave"].get<std::string>()).second)report["campos"].push_back(campo);
     if(!inspeccionar)part=leer(out);
     std::remove(in.c_str());std::remove(out.c_str());std::remove(meta.c_str());
    }else if(!changes.empty())throw std::runtime_error("Esta entrada del icono no admite datos EXIF.");
    uint32_t start=static_cast<uint32_t>(output.size()),size=static_cast<uint32_t>(part.size());
    for(int b=0;b<4;b++){output[entry+8+b]=(size>>(8*b))&255;output[entry+12+b]=(start>>(8*b))&255;}
    output.insert(output.end(),part.begin(),part.end());
   }
   if(!inspeccionar)escribir(argv[2],noop?raw:output);informe(argv[4],report);return 0;
  }
  Exiv2::XmpParser::initialize();
  auto image=Exiv2::ImageFactory::open(argv[1]);if(!image)throw std::runtime_error("No se puede leer la imagen.");
  image->readMetadata();auto exif=image->exifData();
  json report={{"campos",json::array()},{"ubicacion",false},{"mime",image->mimeType()}};
  std::set<uint16_t> mostradas;int otros=0;
  for(const auto& datum:exif) {
   auto tag=datum.tag();
   if(datum.groupName()=="GPSInfo"){report["ubicacion"]=true;continue;}
   auto known=etiquetas.find(tag);
   if(known==etiquetas.end()){otros++;continue;}
   if(!mostradas.insert(tag).second)continue;
   auto text=datum.toString();if(text.size()>1024*1024)throw std::runtime_error("El metadato es demasiado grande.");
   report["campos"].push_back({{"clave","exif:"+std::to_string(tag)},{"etiqueta",known->second},{"texto",text},{"valor",text},{"editable",true}});
  }
  if(report["ubicacion"].get<bool>())report["campos"].push_back(bloque("gps","Ubicación","Coordenadas GPS incrustadas"));
  if(otros)report["campos"].push_back(bloque("exif:otros","Otros datos de la cámara",std::to_string(otros)+" campos técnicos"));
  if(!image->xmpData().empty()||!image->xmpPacket().empty())report["campos"].push_back(bloque("xmp","Metadatos XMP","un bloque incrustado en el archivo"));
  if(!image->iptcData().empty())report["campos"].push_back(bloque("iptc","Datos IPTC (pies de foto, autoría)","un bloque incrustado en el archivo"));
  if(!image->comment().empty())report["campos"].push_back(bloque("comentario","Comentario",image->comment()));
  if(!inspeccionar) {
   if(noop||(image->mimeType()=="image/x-ms-bmp"&&changes.empty())||(image->mimeType()=="image/bmp"&&changes.empty())){escribir(argv[2],raw);informe(argv[4],report);return 0;}
   auto selected=options.value("seleccion",json(nullptr)),changes=options.value("cambios",json::object());
   if(!selected.is_null()&&!selected.is_array())throw std::runtime_error("La selección no es válida.");
   if(!changes.is_object())throw std::runtime_error("Los cambios no son válidos.");
   std::set<std::string> borrar;
   if(selected.is_array())for(const auto& v:selected){if(!v.is_string())throw std::runtime_error("La selección no es válida.");borrar.insert(v.get<std::string>());}
   bool todo=selected.is_null();
   for(auto it=exif.begin();it!=exif.end();) {
    bool gps=it->groupName()=="GPSInfo";
    bool remove=todo||(gps&&borrar.count("gps"))||(!gps&&etiquetas.count(it->tag())&&borrar.count("exif:"+std::to_string(it->tag())))||(!gps&&!etiquetas.count(it->tag())&&borrar.count("exif:otros"));
    if(remove)it=exif.erase(it);else ++it;
   }
   for(auto it=changes.begin();it!=changes.end();++it) {
    if(!it.value().is_string()||it.key().rfind("exif:",0)!=0)throw std::runtime_error("El cambio no es válido.");
    if(borrar.count(it.key()))throw std::runtime_error("No se puede borrar y cambiar el mismo dato.");
    auto text=it.value().get<std::string>();if(text.size()>2000)throw std::runtime_error("El valor supera 500 caracteres.");
    auto id=std::stoul(it.key().substr(5));if(id>65535||!etiquetas.count(static_cast<uint16_t>(id)))throw std::runtime_error("El metadato no es editable.");
    bool encontrado=false;
    for(auto& datum:exif)if(datum.tag()==id){datum.setValue(text);encontrado=true;}
    if(!encontrado){Exiv2::ExifKey key(static_cast<uint16_t>(id),id>=0x9000?"Photo":"Image");exif[key.key()]=text;}
   }
   {std::ifstream in(argv[1],std::ios::binary);std::ofstream out(argv[2],std::ios::binary);out<<in.rdbuf();if(!out)throw std::runtime_error("No se puede guardar la imagen.");}
   auto output=Exiv2::ImageFactory::open(argv[2]);output->readMetadata();output->setExifData(exif);
   if(todo||borrar.count("xmp")){output->clearXmpData();output->clearXmpPacket();}
   if(todo||borrar.count("iptc"))output->clearIptcData();
   if(todo||borrar.count("comentario"))output->clearComment();
   output->writeMetadata();
  }
  std::ofstream out(argv[4]);out<<report.dump(-1,' ',false,json::error_handler_t::replace);if(!out)throw std::runtime_error("No se puede escribir el informe.");
  Exiv2::XmpParser::terminate();return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
