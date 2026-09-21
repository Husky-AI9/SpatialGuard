package dev.spatialguard.preview;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Credentials are encrypted with a non-exportable Android Keystore AES key. */
@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private static final String ALIAS = "spatialguard.session.v1";
    private SharedPreferences prefs() { return getContext().getSharedPreferences("secure_session", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    @PluginMethod public void read(PluginCall call) {
        try {
            String token = "";
            String value = prefs().getString("ciphertext", "");
            if (!value.isEmpty()) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                byte[] iv = Base64.decode(prefs().getString("iv", ""), Base64.NO_WRAP);
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
                token = new String(cipher.doFinal(Base64.decode(value, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            }
            JSObject result = new JSObject();
            result.put("token", token);
            // Debug uses ADB reverse. Release receives the hosted HTTPS origin at build time.
            result.put("apiUrl", BuildConfig.SPATIALGUARD_API_URL);
            call.resolve(result);
        } catch (Exception e) {
            prefs().edit().clear().commit();
            call.reject("Secure session unavailable. Pair this device again.");
        }
    }
    @PluginMethod public void write(PluginCall call) {
        try {
            String token = call.getString("token");
            if (token == null || token.length() < 20 || token.length() > 200) { call.reject("Invalid session"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] ciphertext = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            boolean saved = prefs().edit().putString("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit();
            if (!saved) { call.reject("Could not save session"); return; }
            call.resolve();
        } catch (Exception e) { call.reject("Could not save secure session"); }
    }
    @PluginMethod public void clear(PluginCall call) {
        prefs().edit().clear().commit();
        call.resolve();
    }
}
