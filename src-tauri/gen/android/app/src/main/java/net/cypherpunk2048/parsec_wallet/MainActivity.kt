package net.cypherpunk2048.parsec_wallet

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // A wallet shows recovery phrases and keys: keep every screen out of the recent-apps
    // preview and out of screenshots and screen recordings.
    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

    // Edge to edge, the system no longer shrinks the app for the keyboard: lift the page
    // by the keyboard's height so a focused field is never hidden under it. The status
    // and gesture bars are left to the page (CSS env(safe-area-inset-*)).
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(0, 0, 0, ime.bottom)
      insets
    }
  }
}
