plugins {
    id("org.mytonwallet.android.library")
}

android {
    namespace = "org.mytonwallet.app_air.tangem"
}

val airSubModulePath = project.property("airSubModulePath")

dependencies {
    implementation(libs.tangem.card.android)
    implementation(libs.tangem.card.core)
    implementation(libs.androidx.activity)
    implementation(libs.material)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(project("$airSubModulePath:WalletCore"))
}
