package com.solanamobile.seekerconnect.android

import androidx.activity.ComponentActivity
import com.solanamobile.seekerconnect.testing.SeekerLinkContractTest
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MwaSeekerLinkContractTest : SeekerLinkContractTest<ComponentActivity>() {
    override fun createContext() = FakeMwa()

    override fun releaseContext() = (context as FakeMwa).close()
}
