# ═══════════════════════════════════════════════════════════════
# 다담 SketchUp 자동 마킹 도구 (dadam-mark)
#
# 디자이너가 SketchUp 에서 직접 작업한 가구를 dadamfurniture.com 의 planner UI 로
# 가져올 수 있게 outliner name 을 dadam.{category}.{partId} 패턴으로 자동 설정.
#
# 설치
#   1. 본 파일을 SketchUp Plugins 폴더에 복사:
#        Windows: %AppData%\SketchUp\SketchUp 2026\SketchUp\Plugins\
#        macOS:   ~/Library/Application Support/SketchUp 2026/SketchUp/Plugins/
#   2. SketchUp 재시작
#   3. 메뉴 'Extensions > 다담 자동 마킹' 확인
#
# 사용
#   1. '다담 Template 생성' — 6 preset Group + 안내 layer 자동 생성
#   2. '현재 카테고리 설정' — 작업 중인 가구 카테고리 지정
#   3. '선택 entity 마킹' — 선택된 group 에 dadam.* outliner name 자동 적용
#
# 이후 planner UI 의 '📥 SketchUp 에서 가져오기' 클릭 → 자동 가구 복원.
# ═══════════════════════════════════════════════════════════════

require 'sketchup.rb'

module Dadam
  module Mark
    VERSION = '1.0.0'
    PRESETS = ['sink', 'wardrobe', 'vanity', 'shoe', 'fridge', 'storage']
    PRESET_LABELS = {
      'sink'     => '싱크대 (주방)',
      'wardrobe' => '붙박이장 (침실)',
      'vanity'   => '화장대',
      'shoe'     => '신발장 (현관)',
      'fridge'   => '냉장고장 (주방)',
      'storage'  => '범용 수납장',
    }

    # ─────────────────────────────────────────────────────────────
    # 메뉴 등록
    # ─────────────────────────────────────────────────────────────

    unless file_loaded?(__FILE__)
      menu = UI.menu('Extensions').add_submenu('다담 자동 마킹')
      menu.add_item('다담 Template 생성') { Dadam::Mark.create_template }
      menu.add_item('현재 카테고리 설정') { Dadam::Mark.set_category }
      menu.add_item('선택 entity 마킹 (자동)') { Dadam::Mark.mark_selection }
      menu.add_item('선택 entity 마킹 (지정 partId)') { Dadam::Mark.mark_selection_custom }
      menu.add_separator
      menu.add_item('현재 마킹 상태 확인') { Dadam::Mark.show_status }
      menu.add_item('도움말 / 사용법') { Dadam::Mark.show_help }
      file_loaded(__FILE__)
    end

    # ─────────────────────────────────────────────────────────────
    # 1. Template 생성 — 6 preset Group + 안내
    # ─────────────────────────────────────────────────────────────

    def self.create_template
      model = Sketchup.active_model
      model.start_operation('dadam_template_create', true)

      PRESETS.each_with_index do |cat, i|
        # 각 preset 별 Group (X 축 따라 배치, 1500mm 간격)
        group = model.active_entities.add_group
        label = PRESET_LABELS[cat]
        group.name = "dadam.#{cat}.template_placeholder"

        # 카테고리 라벨용 작은 박스 (500×400×80mm)
        x_offset = i * 1500 / 25.4  # mm → inch
        w = 500 / 25.4
        d = 400 / 25.4
        h = 80 / 25.4
        face = group.entities.add_face(
          [x_offset, 0, 0],
          [x_offset + w, 0, 0],
          [x_offset + w, d, 0],
          [x_offset, d, 0]
        )
        face.pushpull(h) if face

        # 머티리얼 (라벨용)
        mat_name = "dadam_template_#{cat}"
        mat = model.materials[mat_name] || model.materials.add(mat_name)
        case cat
        when 'sink'     then mat.color = Sketchup::Color.new(241, 237, 227)  # cream
        when 'wardrobe' then mat.color = Sketchup::Color.new(209, 176, 137)  # oak
        when 'vanity'   then mat.color = Sketchup::Color.new(196, 180, 156)  # accent
        when 'shoe'     then mat.color = Sketchup::Color.new(139, 100, 71)   # walnut
        when 'fridge'   then mat.color = Sketchup::Color.new(105, 106, 107)  # graphite
        when 'storage'  then mat.color = Sketchup::Color.new(180, 138, 106)  # accent
        end
        group.material = mat
      end

      model.commit_operation

      UI.messagebox(
        "✓ 6 preset Group 이 생성됐습니다.\n\n" +
        "사용법:\n" +
        "1. 메뉴 '현재 카테고리 설정' 으로 작업할 카테고리 선택\n" +
        "2. 해당 Group 안에서 가구 모델링\n" +
        "3. 작업한 Group/component 들을 선택 후 '선택 entity 마킹'\n" +
        "4. planner UI 의 '📥 SketchUp 에서 가져오기' 클릭"
      )
    end

    # ─────────────────────────────────────────────────────────────
    # 2. 현재 카테고리 설정 (model attribute 에 저장)
    # ─────────────────────────────────────────────────────────────

    def self.set_category
      model = Sketchup.active_model
      current = model.get_attribute('dadam', 'current_category', 'sink')

      prompts = ['카테고리']
      defaults = [current]
      choices = [PRESETS.join('|')]
      result = UI.inputbox(prompts, defaults, choices, '다담 카테고리 설정')
      return unless result

      cat = result[0]
      unless PRESETS.include?(cat)
        UI.messagebox("⚠️ '#{cat}' 는 유효하지 않은 카테고리입니다.")
        return
      end

      model.set_attribute('dadam', 'current_category', cat)
      UI.messagebox("✓ 카테고리: #{cat} (#{PRESET_LABELS[cat]})")
    end

    # ─────────────────────────────────────────────────────────────
    # 3. 선택 entity 자동 마킹 (현재 카테고리 + auto partId)
    # ─────────────────────────────────────────────────────────────

    def self.mark_selection
      model = Sketchup.active_model
      selection = model.selection.to_a

      if selection.empty?
        UI.messagebox('⚠️ Entity 를 먼저 선택하세요.')
        return
      end

      category = model.get_attribute('dadam', 'current_category', nil)
      if category.nil? || category.empty?
        UI.messagebox("⚠️ 먼저 '현재 카테고리 설정' 으로 카테고리를 지정하세요.")
        return
      end

      groups = selection.select { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) }
      if groups.empty?
        UI.messagebox('⚠️ 선택된 항목 중 Group/Component 가 없습니다.')
        return
      end

      model.start_operation('dadam_mark_selection', true)
      timestamp = Time.now.to_i
      groups.each_with_index do |ent, i|
        part_id = "imported_#{timestamp}_#{i}"
        ent.name = "dadam.#{category}.#{part_id}"
      end
      model.commit_operation

      UI.messagebox("✓ #{groups.length}개 entity 가 dadam.#{category}.* 로 마킹됐습니다.")
    end

    # ─────────────────────────────────────────────────────────────
    # 4. 선택 entity 마킹 (사용자가 partId 명시)
    # ─────────────────────────────────────────────────────────────

    def self.mark_selection_custom
      model = Sketchup.active_model
      selection = model.selection.to_a.select { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) }

      if selection.empty?
        UI.messagebox('⚠️ Group/Component 를 선택하세요 (1개만).')
        return
      end
      if selection.length > 1
        UI.messagebox("⚠️ 한 개만 선택하세요 (현재 #{selection.length}개).")
        return
      end

      category = model.get_attribute('dadam', 'current_category', 'sink')
      ent = selection.first

      # 기본값: 기존 이름의 dadam.* 형식이면 그대로, 아니면 timestamp
      default_part_id = if ent.name.start_with?("dadam.#{category}.")
        ent.name.sub("dadam.#{category}.", '')
      else
        "manual_#{Time.now.to_i}"
      end

      prompts = ['카테고리', 'partId (예: body-1, lower-door-3, toekick)']
      defaults = [category, default_part_id]
      result = UI.inputbox(prompts, defaults, [PRESETS.join('|'), ''], '다담 마킹 (사용자 지정)')
      return unless result

      cat = result[0]
      part_id = result[1]
      unless PRESETS.include?(cat)
        UI.messagebox("⚠️ '#{cat}' 는 유효하지 않은 카테고리입니다.")
        return
      end

      # partId sanitize (영숫자/_/-/. 만 허용)
      part_id = part_id.gsub(/[^A-Za-z0-9_.\-]/, '_')

      model.start_operation('dadam_mark_custom', true)
      ent.name = "dadam.#{cat}.#{part_id}"
      model.commit_operation

      UI.messagebox("✓ '#{ent.name}' 로 마킹됐습니다.")
    end

    # ─────────────────────────────────────────────────────────────
    # 5. 현재 마킹 상태 확인
    # ─────────────────────────────────────────────────────────────

    def self.show_status
      model = Sketchup.active_model
      groups = model.active_entities.to_a.select { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) }
      total = groups.length
      dadam = groups.count { |e| e.name =~ /^dadam\.(sink|wardrobe|vanity|shoe|fridge|storage)\./ }

      cat = model.get_attribute('dadam', 'current_category', '미설정')

      summary = "활성 model: #{total}개 entity\n"
      summary += "dadam.* 마킹: #{dadam}개\n"
      summary += "그 외 (unknown): #{total - dadam}개\n\n"
      summary += "현재 카테고리: #{cat}"

      UI.messagebox(summary)
    end

    # ─────────────────────────────────────────────────────────────
    # 6. 도움말
    # ─────────────────────────────────────────────────────────────

    def self.show_help
      UI.messagebox(
        "다담 SketchUp 자동 마킹 도구 v#{VERSION}\n\n" +
        "1. '다담 Template 생성' — 6 preset Group 견본 생성\n" +
        "2. '현재 카테고리 설정' — 작업 카테고리 (sink/wardrobe/...) 지정\n" +
        "3. '선택 entity 마킹 (자동)' — 선택된 Group 에 dadam.{cat}.imported_TIMESTAMP_N 설정\n" +
        "4. '선택 entity 마킹 (지정 partId)' — 한 Group 에 사용자 partId 적용\n" +
        "5. '현재 마킹 상태 확인' — dadam.* 마킹된 entity 수 확인\n\n" +
        "이후 dadamfurniture.com 의 planner UI 에서 '📥 SketchUp 에서 가져오기' 클릭."
      )
    end
  end
end
