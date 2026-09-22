<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <NaiveProviderInjector>
            <NuxtLayout>
              <NuxtPage />
            </NuxtLayout>
          </NaiveProviderInjector>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import type { GlobalThemeOverrides } from 'naive-ui'
import { zhCN, dateZhCN } from 'naive-ui'

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#169C91',
    primaryColorHover: '#2BB5A8',
    primaryColorPressed: '#0F7A72',
    primaryColorSuppl: '#169C91',
    successColor: '#36C676',
    successColorHover: '#5DD396',
    successColorPressed: '#2BA85F',
    warningColor: '#FF9500',
    warningColorHover: '#FFB340',
    warningColorPressed: '#CC7700',
    errorColor: '#F44336',
    errorColorHover: '#FF6B5E',
    errorColorPressed: '#C33529',
    infoColor: '#169C91',
    infoColorHover: '#2BB5A8',
    infoColorPressed: '#0F7A72',
    textColorBase: '#333333',
    textColor1: '#333333',
    textColor2: '#666666',
    textColor3: '#999999',
    bodyColor: '#F7F9FA',
    cardColor: '#FFFFFF',
    dividerColor: '#E5E7EB',
    borderColor: '#E5E7EB',
  },
  Button: {
    textColorPrimary: '#FFFFFF',
    textColorWarning: '#FFFFFF',
    textColorError: '#FFFFFF',
  },
}
</script>