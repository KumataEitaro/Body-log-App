Pod::Spec.new do |s|
  s.name           = 'WidgetBridge'
  s.version        = '1.0.0'
  s.summary        = 'BodyLog widget data bridge'
  s.description    = 'App Group の UserDefaults へホーム画面ウィジェット用の今日サマリーを書き出すローカルモジュール'
  s.license        = 'MIT'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
