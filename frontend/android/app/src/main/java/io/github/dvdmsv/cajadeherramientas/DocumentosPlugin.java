package io.github.dvdmsv.cajadeherramientas;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.UUID;

/** Storage Access Framework: el usuario elige el destino, sin acceso general al disco. */
@CapacitorPlugin(name = "Documentos")
public class DocumentosPlugin extends Plugin {
    private File origen(PluginCall call) throws Exception {
        String ruta = call.getString("ruta", "");
        Uri uri = Uri.parse(ruta);
        if (!"file".equals(uri.getScheme())) throw new Exception("Origen no válido.");
        File archivo = new File(uri.getPath()).getCanonicalFile();
        File carpeta = new File(getContext().getCacheDir(), "exportaciones").getCanonicalFile();
        if (!archivo.getParentFile().equals(carpeta) || !archivo.isFile())
            throw new Exception("El archivo temporal ya no está disponible.");
        return archivo;
    }

    /** Las copias compartidas la vez anterior: la app que las recibió ya ha tenido tiempo de leerlas. */
    @Override
    public void load() {
        MotorGhostscript.borrar(new File(getContext().getCacheDir(), "compartir"));
    }

    /**
     * La hoja de compartir de Android. El archivo se copia a `compartir/` con su
     * nombre (la app que lo recibe enseña ése) y se ofrece por FileProvider con
     * permiso de lectura sólo para quien lo reciba. No se borra al volver: la
     * otra app puede leerlo más tarde; se borra en el siguiente arranque.
     */
    @PluginMethod
    public void compartir(PluginCall call) {
        try {
            File archivo = origen(call);
            String nombre = call.getString("nombre", "documento").replaceAll("[\\x00-\\x1f\\x7f/\\\\:*?\"<>|]", "").trim();
            File dir = new File(new File(getContext().getCacheDir(), "compartir"), UUID.randomUUID().toString());
            if (!dir.mkdirs()) throw new Exception("Sin espacio en la caché.");
            File copia = new File(dir, nombre.isEmpty() ? "documento" : nombre);
            Files.copy(archivo.toPath(), copia.toPath());
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", copia);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(call.getString("tipo", "application/octet-stream"));
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.setClipData(android.content.ClipData.newRawUri(copia.getName(), uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(intent, null));
            call.resolve();
        } catch (Exception e) { call.reject("No se ha podido compartir el archivo.", e); }
    }

    @PluginMethod
    public void guardar(PluginCall call) {
        try {
            origen(call);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(call.getString("tipo", "application/octet-stream"));
            intent.putExtra(Intent.EXTRA_TITLE, call.getString("nombre", "documento.pdf"));
            startActivityForResult(call, intent, "destinoElegido");
        } catch (Exception e) { call.reject("No se ha podido abrir el selector de archivos.", e); }
    }

    @ActivityCallback
    private void destinoElegido(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("guardado", false));
            return;
        }
        Uri destino = result.getData().getData();
        getBridge().execute(() -> {
            try (FileInputStream entrada = new FileInputStream(origen(call));
                 OutputStream salida = getContext().getContentResolver().openOutputStream(destino, "wt")) {
                if (salida == null) throw new Exception("No se puede escribir en el destino.");
                byte[] bloque = new byte[64 * 1024];
                int leidos;
                while ((leidos = entrada.read(bloque)) != -1) salida.write(bloque, 0, leidos);
                salida.flush();
                call.resolve(new JSObject().put("guardado", true));
            } catch (Exception e) { call.reject("No se ha podido guardar el archivo. Comprueba el espacio disponible.", e); }
        });
    }
}
