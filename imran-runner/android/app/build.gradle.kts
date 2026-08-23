plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.imran.runner"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.imran.runner"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        resourceConfigurations += listOf("en")
        vectorDrawables { useSupportLibrary = true }
    }

    // Self-signed distribution key. This app is installed by sideloading the APK
    // rather than through a store, so the key lives in the repo to keep every
    // rebuild update-compatible with the one already on the phone. It is not a
    // credential for any service.
    signingConfigs {
        create("distribution") {
            storeFile = rootProject.file("imran-runner.keystore")
            storePassword = "imranrunner"
            keyAlias = "imranrunner"
            keyPassword = "imranrunner"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("distribution")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/DEPENDENCIES")
        }
    }

    lint {
        // The build must not be held hostage by advisory checks, but anything
        // that would actually break the app at runtime still fails it.
        abortOnError = true
        warningsAsErrors = false
        // Lint runs as its own CI step before the APK is assembled, so it reports clearly
        // instead of surfacing as a mysterious failure inside the release build.
        checkReleaseBuilds = false
        disable += setOf("MissingTranslation", "UnusedResources", "VectorPath", "ObsoleteLintCustomCheck")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    val composeBom = platform("androidx.compose:compose-bom:2024.11.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
