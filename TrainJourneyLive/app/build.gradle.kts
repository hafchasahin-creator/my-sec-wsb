plugins { id("com.android.application") }

android {
    namespace = "com.trainjourney.live"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.trainjourney.live"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            storeFile = file("../keystore/trainjourney.jks")
            storePassword = "trainjourney"
            keyAlias = "trainjourney"
            keyPassword = "trainjourney"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    // The app deliberately uses only the Android framework - no AndroidX, no
    // third-party libraries - so it builds anywhere and stays a small download.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

dependencies { }
