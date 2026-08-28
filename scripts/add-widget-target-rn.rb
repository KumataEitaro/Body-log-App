# BodyLogWidget（WidgetKit拡張）ターゲットを、expo prebuild 後の RN版Xcodeプロジェクトへ追加する。
# Macなし運用のため、pbxprojをgitで管理せずCodemagic上で毎回生成する（クリーンなクローンに対して冪等）。
# 旧Capacitor版の scripts/add-widget-target.rb と同じ流儀（リポジトリルートから実行する）。
# 実行: ruby scripts/add-widget-target-rn.rb （rn-testflight の ENABLE_WIDGET=true ビルドでのみ呼ばれる）
require 'xcodeproj'

PROJ = 'native/ios/BodyLog.xcodeproj'
NAME = 'BodyLogWidget'
BUNDLE_ID = 'com.gotcha.bodylog.rn.widget'
# ソースはリポジトリに静置（native/widget/）。プロジェクト（native/ios/）から見ると ../widget
WIDGET_DIR_FROM_PROJECT = '../widget'
WIDGET_DIR_FROM_ROOT = 'native/widget'

project = Xcodeproj::Project.open(PROJ)

if project.targets.any? { |t| t.name == NAME }
  puts "#{NAME} target already exists — skip"
  exit 0
end

app_target = project.targets.find { |t| t.name == 'BodyLog' }
raise 'BodyLog target not found' unless app_target

# 本体のビルド設定に合わせるための値を拾う（deployment target / バージョン類）
app_settings = app_target.build_configurations.first.build_settings
deploy = app_settings['IPHONEOS_DEPLOYMENT_TARGET'] ||
         project.build_configurations.first.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] ||
         '16.4'
marketing = app_settings['MARKETING_VERSION'] || '1.0'
current = app_settings['CURRENT_PROJECT_VERSION'] || '1'
puts "deployment target=#{deploy} / marketing=#{marketing} / current=#{current}"

# 1) 拡張ターゲット作成（SwiftUI WidgetKit・deployment targetは本体に合わせる）
target = project.new_target(:app_extension, NAME, :ios, deploy)

# 2) ソースとリソースの参照（native/widget/ 配下）
group = project.main_group.new_group('BodyLogWidget', WIDGET_DIR_FROM_PROJECT)
swift_refs = Dir.glob("#{WIDGET_DIR_FROM_ROOT}/*.swift").map { |f| group.new_reference(File.basename(f)) }
raise "no swift sources in #{WIDGET_DIR_FROM_ROOT}" if swift_refs.empty?
target.add_file_references(swift_refs)
group.new_reference('Info.plist')
group.new_reference('BodyLogWidget.entitlements')

# 3) ビルド設定
target.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['PRODUCT_NAME'] = NAME
  s['INFOPLIST_FILE'] = "#{WIDGET_DIR_FROM_PROJECT}/Info.plist"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = "#{WIDGET_DIR_FROM_PROJECT}/BodyLogWidget.entitlements"
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = deploy
  # 本体はiPhone専用（app.jsonにsupportsTabletなし）なので拡張も揃える
  s['TARGETED_DEVICE_FAMILY'] = '1'
  # バージョンは本体に合わせる。この後の「Set build number」ステップの
  # agvtool new-version -all が両ターゲットのCURRENT_PROJECT_VERSIONを揃えて上書きする
  s['MARKETING_VERSION'] = marketing
  s['CURRENT_PROJECT_VERSION'] = current
  s['VERSIONING_SYSTEM'] = 'apple-generic'
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
