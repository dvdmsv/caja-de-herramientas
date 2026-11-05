package io.github.dvdmsv.cajadeherramientas;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Lo que llega de otras apps por «Abrir con» o «Compartir». Se copia a la caché
 * enseguida, mientras dura el permiso de lectura que Android da con el intent,
 * y la página lo recoge con `tomar()` cuando se le avisa con «llegada».
 */
@CapacitorPlugin(name = "Llegadas")
public class LlegadasPlugin extends Plugin {
    /** El mismo tope que un archivo elegido dentro de la app (`MAXIMO_ARCHIVO`). */
    private static final long MAXIMO = 50L * 1024 * 1024;
    /** Para no recoger dos veces el intent con que se abrió la actividad. */
    private static final String RECOGIDO = "io.github.dvdmsv.cajadeherramientas.RECOGIDO";
    private final List<JSObject> pendientes = new ArrayList<>();

    private File carpeta() { return new File(getContext().getCacheDir(), "llegadas"); }

    @Override
    public void load() {
        MotorGhostscript.borrar(carpeta());   // lo que quedara de un arranque anterior
        recoger(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        recoger(intent);
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> uris(Intent intent) {
        List<Uri> lista = new ArrayList<>();
        String accion = intent.getAction();
        if (Intent.ACTION_VIEW.equals(accion) && intent.getData() != null
                && ContentResolver.SCHEME_CONTENT.equals(intent.getData().getScheme())) {
            lista.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(accion)) {
            Uri uri = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) lista.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(accion)) {
            ArrayList<Uri> varias = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (varias != null) for (Uri uri : varias) if (uri != null) lista.add(uri);
        }
        return lista;
    }

    private void recoger(Intent intent) {
        if (intent == null || intent.getBooleanExtra(RECOGIDO, false)) return;
        List<Uri> lista = uris(intent);
        if (lista.isEmpty()) return;
        intent.putExtra(RECOGIDO, true);
        getBridge().execute(() -> {
            List<JSObject> nuevos = new ArrayList<>();
            for (Uri uri : lista) {
                try { nuevos.add(copiar(uri)); }
                catch (Exception e) { nuevos.add(new JSObject().put("nombre", nombre(uri)).put("error", true)); }
            }
            synchronized (pendientes) { pendientes.addAll(nuevos); }
            notifyListeners("llegada", new JSObject(), true);
        });
    }

    private JSObject copiar(Uri uri) throws IOException {
        String nombre = nombre(uri);
        File dir = new File(carpeta(), UUID.randomUUID().toString());
        if (!dir.mkdirs()) throw new IOException("Sin espacio en la caché.");
        File destino = new File(dir, nombre);
        long total = 0;
        try (InputStream entrada = getContext().getContentResolver().openInputStream(uri);
             OutputStream salida = new FileOutputStream(destino)) {
            if (entrada == null) throw new IOException("No se puede leer.");
            byte[] bloque = new byte[64 * 1024];
            int leidos;
            while ((leidos = entrada.read(bloque)) != -1) {
                total += leidos;
                if (total > MAXIMO) {
                    MotorGhostscript.borrar(dir);
                    return new JSObject().put("nombre", nombre).put("grande", true);
                }
                salida.write(bloque, 0, leidos);
            }
        }
        String tipo = getContext().getContentResolver().getType(uri);
        return new JSObject().put("ruta", Uri.fromFile(destino).toString()).put("nombre", nombre)
            .put("tipo", tipo == null ? "" : tipo);
    }

    /** El nombre que enseña quien lo comparte, sin lo que no vale en un nombre de archivo. */
    private String nombre(Uri uri) {
        String nombre = null;
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) nombre = cursor.getString(0);
        } catch (Exception ignorado) { }
        if (nombre == null) nombre = uri.getLastPathSegment();
        nombre = nombre == null ? "" : nombre.replaceAll("[\\x00-\\x1f\\x7f/\\\\:*?\"<>|]", "").trim();
        if (nombre.length() > 160) nombre = nombre.substring(nombre.length() - 160);
        return nombre.isEmpty() ? "archivo" : nombre;
    }

    @PluginMethod
    public void tomar(PluginCall call) {
        JSArray archivos = new JSArray();
        synchronized (pendientes) {
            for (JSObject archivo : pendientes) archivos.put(archivo);
            pendientes.clear();
        }
        call.resolve(new JSObject().put("archivos", archivos));
    }

    /** Borra las copias ya leídas por la página. */
    @PluginMethod
    public void soltar(PluginCall call) {
        try {
            File raiz = carpeta().getCanonicalFile();
            JSArray rutas = call.getArray("rutas", new JSArray());
            for (int i = 0; i < rutas.length(); i++) {
                Uri uri = Uri.parse(rutas.getString(i));
                if (!"file".equals(uri.getScheme())) continue;
                File dir = new File(uri.getPath()).getCanonicalFile().getParentFile();
                if (dir != null && raiz.equals(dir.getParentFile())) MotorGhostscript.borrar(dir);
            }
            call.resolve();
        } catch (Exception e) { call.reject("No se han podido borrar las copias.", e); }
    }
}
