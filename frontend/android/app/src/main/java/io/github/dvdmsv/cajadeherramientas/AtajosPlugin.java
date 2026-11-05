package io.github.dvdmsv.cajadeherramientas;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/**
 * Los atajos que salen al mantener pulsado el icono: las favoritas. Cada uno
 * abre `cajadeherramientas://herramientas/<slug>`, que la página recibe con el
 * `appUrlOpen` de @capacitor/app y navega.
 */
@CapacitorPlugin(name = "Atajos")
public class AtajosPlugin extends Plugin {
    @PluginMethod
    public void fijar(PluginCall call) {
        try {
            JSArray atajos = call.getArray("atajos", new JSArray());
            int maximo = Math.min(4, ShortcutManagerCompat.getMaxShortcutCountPerActivity(getContext()));
            List<ShortcutInfoCompat> lista = new ArrayList<>();
            for (int i = 0; i < atajos.length() && lista.size() < maximo; i++) {
                JSObject atajo = JSObject.fromJSONObject(atajos.getJSONObject(i));
                String slug = atajo.getString("slug", "");
                String nombre = atajo.getString("nombre", "");
                if (!slug.matches("[a-z0-9-]{1,40}") || nombre.isEmpty()) continue;
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("cajadeherramientas://herramientas/" + slug),
                    getContext(), MainActivity.class);
                lista.add(new ShortcutInfoCompat.Builder(getContext(), slug)
                    .setShortLabel(nombre.length() > 25 ? nombre.substring(0, 25) : nombre)
                    .setLongLabel(nombre)
                    .setIcon(IconCompat.createWithResource(getContext(), R.mipmap.ic_launcher))
                    .setIntent(intent)
                    .build());
            }
            ShortcutManagerCompat.setDynamicShortcuts(getContext(), lista);
            call.resolve();
        } catch (Exception e) { call.reject("No se han podido poner los atajos.", e); }
    }
}
