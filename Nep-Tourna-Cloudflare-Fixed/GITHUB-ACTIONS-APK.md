# Nep Tourna — Browser-Only APK Build

This project includes a GitHub Actions workflow at `.github/workflows/android-apk.yml`.

No Android Studio, Node.js, Java, Gradle, or Android SDK needs to be installed on your computer.

## GitHub browser steps

1. Upload the project files to a GitHub repository.
2. Make sure `.github/workflows/android-apk.yml` is present in the repository root.
3. Open the repository's **Actions** tab.
4. Select **Nep Tourna Android APK**.
5. Click **Run workflow**.
6. Wait for the workflow to finish successfully.
7. Open the completed workflow run.
8. Scroll to **Artifacts**.
9. Download **Nep-Tourna-Android-APK**.
10. Inside the downloaded artifact is `app-debug.apk`.

The workflow can also run automatically when code is pushed to `main` or `master`.
