-- =============================================
-- 다담가구 안정성 강화 트리거 및 함수
-- 데이터 일관성 및 자동 로깅을 위한 DB 트리거
-- =============================================

-- =============================================
-- 1. Expert 승인 시 자동 티어 변경 트리거
-- expert_requests 테이블 상태가 'approved'로 변경되면
-- profiles 테이블의 tier도 자동으로 업데이트
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_expert_request_approval()
RETURNS TRIGGER AS $$
BEGIN
    -- 상태가 'approved'로 변경된 경우에만 실행
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
        -- profiles 테이블의 tier 업데이트
        UPDATE public.profiles
        SET
            tier = NEW.requested_tier,
            company_name = COALESCE(NEW.company_name, profiles.company_name),
            business_number = COALESCE(NEW.business_number, profiles.business_number),
            updated_at = NOW()
        WHERE id = NEW.user_id;

        -- auth.users의 user_metadata도 업데이트 (동기화)
        UPDATE auth.users
        SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('tier', NEW.requested_tier)
        WHERE id = NEW.user_id;

        -- 승인 로그 자동 기록
        INSERT INTO public.admin_logs (
            admin_id,
            admin_email,
            action_type,
            target_type,
            target_id,
            description,
            old_value,
            new_value
        ) VALUES (
            NEW.reviewed_by,
            (SELECT email FROM auth.users WHERE id = NEW.reviewed_by),
            'tier_change',
            'user',
            NEW.user_id,
            'Expert 승급 승인: ' || NEW.user_email,
            jsonb_build_object('tier', OLD.current_tier),
            jsonb_build_object('tier', NEW.requested_tier)
        );
    END IF;

    -- 상태가 'rejected'로 변경된 경우 로그 기록
    IF NEW.status = 'rejected' AND (OLD.status IS NULL OR OLD.status != 'rejected') THEN
        INSERT INTO public.admin_logs (
            admin_id,
            admin_email,
            action_type,
            target_type,
            target_id,
            description,
            old_value,
            new_value
        ) VALUES (
            NEW.reviewed_by,
            (SELECT email FROM auth.users WHERE id = NEW.reviewed_by),
            'expert_request',
            'expert_request',
            NEW.id,
            'Expert 승급 거절: ' || NEW.user_email,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', 'rejected', 'memo', NEW.admin_memo)
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
DROP TRIGGER IF EXISTS on_expert_request_update ON expert_requests;
CREATE TRIGGER on_expert_request_update
    AFTER UPDATE ON expert_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_expert_request_approval();


-- =============================================
-- 2. 상담 상태 변경 시 자동 로그 기록
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_consultation_update()
RETURNS TRIGGER AS $$
BEGIN
    -- 상태가 변경된 경우에만 로그 기록
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.admin_logs (
            admin_id,
            admin_email,
            action_type,
            target_type,
            target_id,
            description,
            old_value,
            new_value
        ) VALUES (
            auth.uid(),
            (SELECT email FROM auth.users WHERE id = auth.uid()),
            'consultation_update',
            'consultation',
            NEW.id,
            '상담 상태 변경: ' || NEW.name || ' (' || OLD.status || ' → ' || NEW.status || ')',
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status, 'memo', NEW.admin_memo)
        );
    END IF;

    -- updated_at 자동 갱신
    NEW.updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
DROP TRIGGER IF EXISTS on_consultation_update ON consultations;
CREATE TRIGGER on_consultation_update
    BEFORE UPDATE ON consultations
    FOR EACH ROW EXECUTE FUNCTION public.handle_consultation_update();


-- =============================================
-- 3. 프로필 변경 시 자동 로그 기록 (관리자에 의한 변경)
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_profile_admin_update()
RETURNS TRIGGER AS $$
DECLARE
    v_admin_id UUID;
BEGIN
    -- 현재 사용자가 관리자인지 확인
    SELECT user_id INTO v_admin_id
    FROM admin_roles
    WHERE user_id = auth.uid();

    -- 관리자가 다른 사용자의 프로필을 수정한 경우에만 로그 기록
    IF v_admin_id IS NOT NULL AND auth.uid() != NEW.id THEN
        -- tier 변경 로그
        IF OLD.tier IS DISTINCT FROM NEW.tier THEN
            INSERT INTO public.admin_logs (
                admin_id,
                admin_email,
                action_type,
                target_type,
                target_id,
                description,
                old_value,
                new_value
            ) VALUES (
                auth.uid(),
                (SELECT email FROM auth.users WHERE id = auth.uid()),
                'tier_change',
                'user',
                NEW.id,
                '회원 등급 변경: ' || NEW.email,
                jsonb_build_object('tier', OLD.tier),
                jsonb_build_object('tier', NEW.tier)
            );
        END IF;

        -- 기타 정보 변경 로그
        IF OLD.name IS DISTINCT FROM NEW.name
           OR OLD.phone IS DISTINCT FROM NEW.phone
           OR OLD.admin_memo IS DISTINCT FROM NEW.admin_memo THEN
            INSERT INTO public.admin_logs (
                admin_id,
                admin_email,
                action_type,
                target_type,
                target_id,
                description,
                old_value,
                new_value
            ) VALUES (
                auth.uid(),
                (SELECT email FROM auth.users WHERE id = auth.uid()),
                'user_update',
                'user',
                NEW.id,
                '회원 정보 수정: ' || NEW.email,
                jsonb_build_object('name', OLD.name, 'phone', OLD.phone, 'memo', OLD.admin_memo),
                jsonb_build_object('name', NEW.name, 'phone', NEW.phone, 'memo', NEW.admin_memo)
            );
        END IF;
    END IF;

    -- updated_at 자동 갱신
    NEW.updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
DROP TRIGGER IF EXISTS on_profile_admin_update ON profiles;
CREATE TRIGGER on_profile_admin_update
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_profile_admin_update();


-- =============================================
-- 4. 새 상담 신청 시 알림 로그
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_new_consultation()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.admin_logs (
        action_type,
        target_type,
        target_id,
        description,
        new_value
    ) VALUES (
        'new_consultation',
        'consultation',
        NEW.id,
        '새 상담 신청: ' || NEW.name || ' - ' || NEW.title,
        jsonb_build_object(
            'name', NEW.name,
            'email', NEW.email,
            'type', NEW.consultation_type,
            'title', NEW.title
        )
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
DROP TRIGGER IF EXISTS on_new_consultation ON consultations;
CREATE TRIGGER on_new_consultation
    AFTER INSERT ON consultations
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_consultation();


-- =============================================
-- 5. 새 Expert 신청 시 알림 로그
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_new_expert_request()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.admin_logs (
        action_type,
        target_type,
        target_id,
        description,
        new_value
    ) VALUES (
        'new_expert_request',
        'expert_request',
        NEW.id,
        '새 Expert 승급 신청: ' || NEW.user_email,
        jsonb_build_object(
            'email', NEW.user_email,
            'name', NEW.user_name,
            'company', NEW.company_name,
            'career', NEW.career_years
        )
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
DROP TRIGGER IF EXISTS on_new_expert_request ON expert_requests;
CREATE TRIGGER on_new_expert_request
    AFTER INSERT ON expert_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_expert_request();


-- =============================================
-- 6. 사용자 로그인 시 프로필 last_sign_in_at 업데이트
-- (auth.users 트리거에서 이미 처리되지만 백업)
-- =============================================

-- 이미 profiles-schema.sql에서 처리됨


-- =============================================
-- 7. admin_logs 테이블 정리 함수 (90일 이상 로그 삭제)
-- 정기적으로 실행 권장 (pg_cron 또는 수동)
-- =============================================

CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM admin_logs
    WHERE created_at < NOW() - INTERVAL '90 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;


-- =============================================
-- 8. 통계 함수: 대시보드용 요약 데이터
-- =============================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS TABLE (
    total_users BIGINT,
    expert_users BIGINT,
    business_users BIGINT,
    pending_expert_requests BIGINT,
    pending_consultations BIGINT,
    today_signups BIGINT,
    today_consultations BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM profiles)::BIGINT as total_users,
        (SELECT COUNT(*) FROM profiles WHERE tier = 'expert')::BIGINT as expert_users,
        (SELECT COUNT(*) FROM profiles WHERE tier = 'business')::BIGINT as business_users,
        (SELECT COUNT(*) FROM expert_requests WHERE status = 'pending')::BIGINT as pending_expert_requests,
        (SELECT COUNT(*) FROM consultations WHERE status = 'pending')::BIGINT as pending_consultations,
        (SELECT COUNT(*) FROM profiles WHERE created_at >= CURRENT_DATE)::BIGINT as today_signups,
        (SELECT COUNT(*) FROM consultations WHERE created_at >= CURRENT_DATE)::BIGINT as today_consultations;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 실행 권한
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;


-- =============================================
-- 9. RLS 정책 보완: admin_logs INSERT 허용 (시스템 트리거용)
-- =============================================

-- 기존 정책 삭제 후 재생성
DROP POLICY IF EXISTS "System can insert logs" ON admin_logs;
CREATE POLICY "System can insert logs" ON admin_logs
    FOR INSERT WITH CHECK (true);


-- =============================================
-- 완료 메시지
-- =============================================
-- 실행 완료 후 다음 트리거들이 활성화됩니다:
-- 1. Expert 승인 시 자동 티어 변경 및 로그
-- 2. 상담 상태 변경 시 자동 로그
-- 3. 관리자의 프로필 수정 시 자동 로그
-- 4. 새 상담 신청 시 알림 로그
-- 5. 새 Expert 신청 시 알림 로그
