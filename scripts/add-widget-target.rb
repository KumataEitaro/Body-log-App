# BodyLogWidgets（WidgetKit拡張）ターゲットをビルド時にXcodeプロジェクトへ追加する。
# Macなし運用のため、pbxprojをgitで管理せずCodemagic上で毎回生成する（クリーンなクローンに対して冪等）。
# 実行: ruby scripts/add-widget-target.rb （ENABLE_WIDGET=true のビルドでのみ呼ばれる）
require 'xcodeproj'

PROJ = 'ios/App/App.xcodeproj'
NAME = 'BodyLogWidgets'
BUNDLE_ID = 'com.gotcha.bodylog.widgets'

project = Xcodeproj::Project.open(PROJ)

if project.targets.any? { |t| t.name == NAME }
  puts "#{NAME} target already exists — skip"
  exit 0
end

app_target = project.targets.find { |t| t.name == 'App' }
raise 'App target not found' unless app_target

# 1) 拡張ターゲット作成（iOS 17+ / SwiftUI WidgetKit）
target = project.new_target(:app_extension, NAME, :ios, '17.0')

# 2) ソースとリソースの参照（ios/App/Widgets/ 配下）
group = project.main_group.new_group('Widgets', 'Widgets')
swift_refs = Dir.glob('ios/App/Widgets/*.swift').map { |f| group.new_reference(File.basename(f)) }
target.add_file_references(swift_refs)
group.new_reference('Info.plist')
group.new_reference('BodyLogWidgets.entitlements')

# 3) ビルド設定
target.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['PRODUCT_NAME'] = NAME
  s['INFOPLIST_FILE'] = 'Widgets/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'Widgets/BodyLogWidgets.entitlements'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['MARKETING_VERSION'] = '1.0'
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['SKIP_INSTALL'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# 4) アプリに埋め込む（Embed Foundation Extensions）
app_target.add_dependency(target)
embed = app_target.copy_files_build_phases.find { |p| p.symbol_dst_subfolder_spec == :plug_ins }
unless embed
  embed = app_target.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.symbol_dst_subfolder_spec = :plug_ins
end
bf = embed.add_file_reference(target.product_reference)
bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "#{NAME} target added to #{PROJ}"
