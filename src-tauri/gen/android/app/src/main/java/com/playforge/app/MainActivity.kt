package com.playforge.app

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import android.content.Intent
import java.io.File
import androidx.core.content.FileProvider

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.setSupportZoom(false)
    webView.settings.builtInZoomControls = false
    webView.settings.displayZoomControls = false
    webView.addJavascriptInterface(AndroidAuthInterface(this, webView), "AndroidAuth")
  }
}

class AndroidAuthInterface(private val activity: MainActivity, private val webView: WebView) {
  @JavascriptInterface
  fun signInWithGoogle(webClientId: String) {
    activity.runOnUiThread {
      val credentialManager = CredentialManager.create(activity)
      val googleIdOption = GetGoogleIdOption.Builder()
        .setFilterByAuthorizedAccounts(false)
        .setServerClientId(webClientId)
        .build()

      val request = GetCredentialRequest.Builder()
        .addCredentialOption(googleIdOption)
        .build()

      CoroutineScope(Dispatchers.Main).launch {
        try {
          val result = credentialManager.getCredential(activity, request)
          val credential = result.credential
          if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.data)
            val idToken = googleIdTokenCredential.idToken
            val js = "window.onAndroidGoogleSignInSuccess && window.onAndroidGoogleSignInSuccess('${idToken.replace("'", "\\'")}')"
            webView.evaluateJavascript(js, null)
          } else {
            val js = "window.onAndroidGoogleSignInError && window.onAndroidGoogleSignInError('Tanınmayan kimlik bilgisi türü.')"
            webView.evaluateJavascript(js, null)
          }
        } catch (e: Exception) {
          val msg = (e.message ?: "Google girişi iptal edildi veya başarısız oldu.").replace("'", "\\'").replace("\n", " ")
          val js = "window.onAndroidGoogleSignInError && window.onAndroidGoogleSignInError('$msg')"
          webView.evaluateJavascript(js, null)
        }
      }
    }
  }

  @JavascriptInterface
  fun openPdf(filePath: String) {
    activity.runOnUiThread {
      try {
        val file = File(filePath)
        val uri = FileProvider.getUriForFile(
          activity,
          "${activity.packageName}.fileprovider",
          file
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, "application/pdf")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
      } catch (e: Exception) {
        android.util.Log.e("PlayForge", "Failed to open PDF: ${e.message}", e)
        val js = "console.error('Failed to open PDF native: ${e.message?.replace("'", "\\'")}')"
        webView.evaluateJavascript(js, null)
      }
    }
  }
}
