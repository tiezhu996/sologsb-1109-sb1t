import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import FilterBar from '../components/common/FilterBar';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHerbFilter } from '../hooks/useHerbFilter';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore, type SegmentInput } from '../stores/batchStore';
import { HERB_ORIGINS, HERB_PARTS } from '../types/herb-material';
import { FIRE_LEVELS, type FireLevel } from '../types/processing-method';
import {
  PROCESS_DEGREES,
  SHIFT_TEAMS,
  type ProcessBatch,
  type ProcessDegree,
  type ProcessSegment,
  type ShiftTeam,
} from '../types/process-batch';
import { DEGREE_RULES, judgeDegree, suggestedValues } from '../utils/degree';
import { allConfirmed, awaitingTeam, calcYieldRate, nextTeamOf, totalDuration } from '../utils/segment';

const { Title, Paragraph, Text } = Typography;

interface HeaderFormValues {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: FireLevel;
  remark?: string;
}

interface SegmentFormValues {
  team: ShiftTeam;
  temp: number;
  durationMin: number;
  startedAt: Dayjs;
  endedAt: Dayjs;
  handover: string;
}

interface FinalizeFormValues {
  outputKg: number;
  degree: ProcessDegree;
}

interface ConfirmFormValues {
  confirmedBy: string;
}

const DEGREE_COLOR: Record<ProcessDegree, string> = { 不及: 'orange', 适中: 'green', 太过: 'red' };

const SEGMENT_TEAM_OPTIONS = SHIFT_TEAMS.map((v) => ({ label: v, value: v }));

/** 工序记录台：跨班分段登记、接班确认，全部段确认后按累计时长与最终重量判定 */
export default function BatchBoard() {
  const { message } = AntApp.useApp();
  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const createBatch = useBatchStore((s) => s.createBatch);
  const updateBatch = useBatchStore((s) => s.updateBatch);
  const appendSegment = useBatchStore((s) => s.appendSegment);
  const updatePendingSegment = useBatchStore((s) => s.updatePendingSegment);
  const confirmSegment = useBatchStore((s) => s.confirmSegment);
  const finalizeBatch = useBatchStore((s) => s.finalizeBatch);
  const lockBatch = useBatchStore((s) => s.lockBatch);
  const unlockAsQc = useBatchStore((s) => s.unlockAsQc);
  const removeBatch = useBatchStore((s) => s.removeBatch);

  const herbFilter = useHerbFilter();
  const [params] = useSearchParams();
  const degreeParam = params.get('degree') ?? '';

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<HeaderFormValues>();
  const [createSegForm] = Form.useForm<SegmentFormValues>();

  const [detail, setDetail] = useState<ProcessBatch | null>(null);
  const [headerForm] = Form.useForm<HeaderFormValues>();
  const [segForm] = Form.useForm<SegmentFormValues>();
  const [finalizeForm] = Form.useForm<FinalizeFormValues>();
  const [confirmForm] = Form.useForm<ConfirmFormValues>();
  const [qcMode, setQcMode] = useState(false);
  const [segmentMode, setSegmentMode] = useState<'none' | 'add' | 'edit'>('none');
  const [editSegment, setEditSegment] = useState<ProcessSegment | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ProcessSegment | null>(null);
  const [showRules, setShowRules] = useState(false);

  /** 弹窗里始终读取 store 中的最新批次（store 更新后同步） */
  const liveDetail = detail ? batches.find((b) => b.id === detail.id) ?? null : null;

  const createWatched = Form.useWatch([], createForm) as Partial<HeaderFormValues> | undefined;
  const createSegWatched = Form.useWatch([], createSegForm) as Partial<SegmentFormValues> | undefined;
  const headerWatched = Form.useWatch([], headerForm) as Partial<HeaderFormValues> | undefined;
  const segWatched = Form.useWatch([], segForm) as Partial<SegmentFormValues> | undefined;
  const finalizeWatched = Form.useWatch([], finalizeForm) as Partial<FinalizeFormValues> | undefined;

  const createMethod = methods.find((m) => m.id === createWatched?.methodId);
  const detailMethod = methods.find((m) => m.id === (headerWatched?.methodId ?? liveDetail?.methodId));

  /** 完工判定：累计时长 + 末段锅温 + 最终重量（得率） */
  const detailVerdict = useMemo(() => {
    if (!liveDetail || !detailMethod || !allConfirmed(liveDetail)) return undefined;
    const outputKg = Number(finalizeWatched?.outputKg) || 0;
    const yieldRate = calcYieldRate(liveDetail.feedKg, outputKg);
    return {
      yieldRate,
      verdict: judgeDegree({
        method: detailMethod,
        fireLevel: liveDetail.fireLevel,
        duration: totalDuration(liveDetail),
        temp: liveDetail.segments[liveDetail.segments.length - 1].temp,
        yieldRate,
      }),
    };
  }, [liveDetail, detailMethod, finalizeWatched?.outputKg]);

  // 录入最终重量后，按累计时长与末段锅温自动建议程度（可复核修改）；锁定回填值不覆盖
  useEffect(() => {
    if (!liveDetail || liveDetail.locked || !detailVerdict) return;
    if (Number(finalizeWatched?.outputKg) > 0) {
      finalizeForm.setFieldValue('degree', detailVerdict.verdict.degree);
    }
  }, [detailVerdict, liveDetail, finalizeWatched?.outputKg, finalizeForm]);

  const visibleHerbs = useMemo(() => herbFilter.apply(herbs), [herbs, herbFilter]);
  const visibleBatches = useMemo(() => {
    const ids = new Set(visibleHerbs.map((h) => h.id));
    return batches.filter((b) => {
      if (!ids.has(b.herbId)) return false;
      if (degreeParam && b.degree !== degreeParam) return false;
      return true;
    });
  }, [batches, visibleHerbs, degreeParam]);

  const herbName = (id: string) => herbs.find((h) => h.id === id)?.name ?? '未知药材';
  const methodOf = (id: string) => methods.find((m) => m.id === id);

  // ---------- 新建 ----------
  const openCreate = () => {
    const firstHerb = herbs[0];
    const firstMethod = methods[0];
    const now = dayjs();
    const feed = firstHerb?.feedKg ?? 100;
    createForm.resetFields();
    createSegForm.resetFields();
    createForm.setFieldsValue({
      batchNo: `PZ-${dayjs().format('YYMMDD')}-${String(batches.length + 1).padStart(2, '0')}`,
      herbId: firstHerb?.id,
      methodId: firstMethod?.id,
      feedKg: feed,
      auxUsedKg: Number(((feed * (firstMethod?.auxRatio ?? 0)) / 100).toFixed(2)),
      fireLevel: firstMethod?.fireLevel ?? '文火',
    });
    createSegForm.setFieldsValue({
      team: '甲班',
      temp: firstMethod ? Math.round((firstMethod.tempRange[0] + firstMethod.tempRange[1]) / 2) : 100,
      durationMin: firstMethod?.duration ?? 12,
      startedAt: now.subtract(20, 'minute'),
      endedAt: now,
      handover: '',
    });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const header = await createForm.validateFields();
    const seg = await createSegForm.validateFields();
    const feedKg = Number(header.feedKg) || 0;
    if (feedKg <= 0) {
      message.error('投料量必须大于 0');
      return;
    }
    const payload = {
      batchNo: header.batchNo,
      herbId: header.herbId,
      methodId: header.methodId,
      feedKg,
      auxUsedKg: Number(header.auxUsedKg) || 0,
      fireLevel: header.fireLevel,
      remark: header.remark,
    };
    const firstSegment: SegmentInput = {
      team: seg.team,
      temp: Number(seg.temp) || 0,
      durationMin: Number(seg.durationMin) || 0,
      handover: seg.handover,
      startedAt: seg.startedAt.toISOString(),
      endedAt: seg.endedAt.toISOString(),
    };
    const batch = await createBatch(payload, firstSegment);
    message.success(`已登记 ${batch.batchNo} 首段（${seg.team}），等待 ${nextTeamOf(seg.team)} 接班确认`);
    setCreateOpen(false);
  };

  // ---------- 详情 / 分段 ----------
  const openDetail = (record: ProcessBatch) => {
    setDetail(record);
    setQcMode(false);
    setSegmentMode('none');
    setEditSegment(null);
    setConfirmTarget(null);
    headerForm.resetFields();
    segForm.resetFields();
    finalizeForm.resetFields();
    headerForm.setFieldsValue({
      batchNo: record.batchNo,
      herbId: record.herbId,
      methodId: record.methodId,
      feedKg: record.feedKg,
      auxUsedKg: record.auxUsedKg,
      fireLevel: record.fireLevel,
      remark: record.remark,
    });
    if (record.outputKg !== undefined && record.degree) {
      finalizeForm.setFieldsValue({ outputKg: record.outputKg, degree: record.degree });
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setQcMode(false);
    setSegmentMode('none');
    setEditSegment(null);
    setConfirmTarget(null);
  };

  const headerReadonly = () => !liveDetail || (liveDetail.locked && !qcMode);

  const submitHeader = async () => {
    if (!liveDetail) return;
    const values = await headerForm.validateFields();
    const patch = {
      batchNo: values.batchNo,
      herbId: values.herbId,
      methodId: values.methodId,
      feedKg: Number(values.feedKg) || 0,
      auxUsedKg: Number(values.auxUsedKg) || 0,
      fireLevel: values.fireLevel,
      remark: values.remark,
    };
    const ok = await updateBatch(liveDetail.id, patch, qcMode);
    if (!ok) {
      message.error('该批已锁定，请打开「质检员改判」后再保存');
      return;
    }
    message.success('表头信息已保存');
  };

  const openAddSegment = () => {
    if (!liveDetail) return;
    const previous = liveDetail.segments[liveDetail.segments.length - 1];
    const method = methodOf(liveDetail.methodId);
    const start = dayjs(previous.endedAt);
    segForm.resetFields();
    segForm.setFieldsValue({
      team: previous.awaitTeam ?? nextTeamOf(previous.team),
      temp: method ? Math.round((method.tempRange[0] + method.tempRange[1]) / 2) : 100,
      durationMin: method?.duration ?? 12,
      startedAt: start,
      endedAt: start.add(method?.duration ?? 12, 'minute'),
      handover: '',
    });
    setSegmentMode('add');
  };

  const openEditSegment = (segment: ProcessSegment) => {
    setEditSegment(segment);
    segForm.resetFields();
    segForm.setFieldsValue({
      team: segment.team,
      temp: segment.temp,
      durationMin: segment.durationMin,
      startedAt: dayjs(segment.startedAt),
      endedAt: dayjs(segment.endedAt),
      handover: segment.handover,
    });
    setSegmentMode('edit');
  };

  const submitSegment = async () => {
    if (!liveDetail) return;
    const values = await segForm.validateFields();
    const input: SegmentInput = {
      team: values.team,
      temp: Number(values.temp) || 0,
      durationMin: Number(values.durationMin) || 0,
      handover: values.handover,
      startedAt: values.startedAt.toISOString(),
      endedAt: values.endedAt.toISOString(),
    };
    if (segmentMode === 'add') {
      const ok = await appendSegment(liveDetail.id, input);
      if (!ok) {
        message.error('仍有未确认的段，需下一班接班后才能继续添加');
        return;
      }
      message.success(`已新增第 ${liveDetail.segments.length + 1} 段（${input.team}），等待 ${nextTeamOf(input.team)} 接班`);
    } else if (segmentMode === 'edit' && editSegment) {
      const ok = await updatePendingSegment(liveDetail.id, editSegment.id, {
        team: input.team,
        temp: input.temp,
        durationMin: input.durationMin,
        handover: input.handover.trim(),
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        awaitTeam: nextTeamOf(input.team),
      });
      if (!ok) {
        message.error('保存失败：该段可能已被接班确认');
        return;
      }
      message.success('已更新待接片段');
    }
    setSegmentMode('none');
    setEditSegment(null);
  };

  const openConfirm = (segment: ProcessSegment) => {
    confirmForm.resetFields();
    confirmForm.setFieldsValue({ confirmedBy: segment.awaitTeam ?? '' });
    setConfirmTarget(segment);
  };

  const submitConfirm = async () => {
    if (!liveDetail || !confirmTarget) return;
    const values = await confirmForm.validateFields();
    const ok = await confirmSegment(liveDetail.id, confirmTarget.id, values.confirmedBy);
    if (!ok) {
      message.error('接班确认失败：该段可能已被确认');
      return;
    }
    message.success(`${values.confirmedBy} 已接班确认，可继续下一段或完工判定`);
    setConfirmTarget(null);
  };

  const submitFinalize = async (andLock: boolean) => {
    if (!liveDetail) return;
    const values = await finalizeForm.validateFields();
    const outputKg = Number(values.outputKg) || 0;
    if (outputKg <= 0) {
      message.error('请先称取最终重量');
      return;
    }
    const yieldRate = calcYieldRate(liveDetail.feedKg, outputKg);

    if (liveDetail.locked) {
      // 质检员改判已锁定批次的得率与程度
      const ok = await updateBatch(liveDetail.id, { outputKg, yieldRate, degree: values.degree }, true);
      if (!ok) {
        message.error('仅质检员可改判已锁定批次');
        return;
      }
      message.success(`质检员已改判，得率 ${yieldRate}%（${values.degree}）`);
      return;
    }

    const ok = await finalizeBatch(liveDetail.id, { outputKg, yieldRate, degree: values.degree });
    if (!ok) {
      message.error('仍有段未接班确认，全部确认后才能完工判定');
      return;
    }
    if (andLock) {
      const locked = await lockBatch(liveDetail.id);
      if (locked) {
        message.success(`完工判定完成：得率 ${yieldRate}%（${values.degree}），该批已锁定`);
        closeDetail();
        return;
      }
    }
    message.success(`完工判定已保存：得率 ${yieldRate}%（${values.degree}），确认无误后可锁定`);
  };

  const handleLock = async (record: ProcessBatch) => {
    const ok = await lockBatch(record.id);
    if (!ok) {
      message.error('全部段确认并完成得率、程度判定后才能锁定');
      return;
    }
    message.success('已锁定该批');
  };

  // ---------- 列表 ----------
  const columns: TableColumnsType<ProcessBatch> = [
    { title: '生产批号', dataIndex: 'batchNo', width: 120, fixed: 'left', render: (v: string) => <Text strong>{v}</Text> },
    { title: '药材', dataIndex: 'herbId', width: 80, render: (id: string) => herbName(id) },
    { title: '方法', dataIndex: 'methodId', width: 80, render: (id: string) => methodOf(id)?.name ?? '-' },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 170,
      render: (v: FireLevel, record) => (
        <FireLevelTag level={v} tempRange={methodOf(record.methodId)?.tempRange} duration={methodOf(record.methodId)?.duration} />
      ),
    },
    { title: '投料(kg)', dataIndex: 'feedKg', width: 85, align: 'right' },
    { title: '辅料(kg)', dataIndex: 'auxUsedKg', width: 85, align: 'right' },
    {
      title: '分段 / 累计时长',
      width: 130,
      render: (_, record) => (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.4 }}>
          <span>{record.segments.map((s) => s.team).join('→')}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.segments.length} 段 · {totalDuration(record)}min
          </Text>
        </Space>
      ),
    },
    {
      title: '得率(%)',
      dataIndex: 'yieldRate',
      width: 90,
      align: 'right',
      render: (v: number | undefined) =>
        v === undefined ? <Text type="secondary">加工中</Text> : <Text type={v < 85 ? 'danger' : undefined}>{v}</Text>,
    },
    {
      title: '程度',
      dataIndex: 'degree',
      width: 80,
      render: (v: ProcessDegree | undefined) => (v ? <Tag color={DEGREE_COLOR[v]}>{v}</Tag> : <Text type="secondary">待判定</Text>),
    },
    {
      title: '状态',
      width: 150,
      render: (_, record) => {
        if (record.locked) {
          return <Tag color="blue">已锁定{record.qcBy ? ` · ${record.qcBy}` : ''}</Tag>;
        }
        const waitTeam = awaitingTeam(record);
        if (waitTeam) {
          return <Tag color="orange">待接班 · 等{waitTeam}</Tag>;
        }
        if (allConfirmed(record)) {
          return <Tag color="gold">待完工判定</Tag>;
        }
        return <Tag>加工中</Tag>;
      },
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openDetail(record)}>
            分段详情
          </Button>
          {!record.locked && record.degree !== undefined ? (
            <Button size="small" type="link" onClick={() => handleLock(record)}>
              锁定
            </Button>
          ) : null}
          {record.locked ? (
            <Button
              size="small"
              type="link"
              onClick={() =>
                unlockAsQc(record.id, '质检员 · 赵敏').then(() => message.success('质检员已放行，可重新编辑'))
              }
            >
              放行
            </Button>
          ) : null}
          <Popconfirm title={`确认删除 ${record.batchNo}？`} onConfirm={() => removeBatch(record.id).then(() => message.success('已删除'))}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderHeaderForm = (formObj: typeof headerForm, watched: Partial<HeaderFormValues> | undefined, create = false) => {
    const watchedMethod = create ? createMethod : detailMethod;
    const disabled = create ? false : headerReadonly();
    return (
      <Form
        form={formObj}
        layout="vertical"
        component="div"
        onValuesChange={(changed) => {
          if ('methodId' in changed) {
            const method = methods.find((m) => m.id === changed.methodId);
            if (method) {
              const feed = Number(formObj.getFieldValue('feedKg')) || 0;
              formObj.setFieldsValue({
                fireLevel: method.fireLevel,
                auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
              } as Partial<HeaderFormValues>);
              if (create) {
                createSegForm.setFieldsValue({
                  temp: suggestedValues(method).temp,
                  durationMin: method.duration,
                } as Partial<SegmentFormValues>);
              }
            }
          }
          if ('feedKg' in changed) {
            const method = methods.find((m) => m.id === formObj.getFieldValue('methodId'));
            if (method) {
              const feed = Number(changed.feedKg) || 0;
              formObj.setFieldsValue({
                auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
              } as Partial<HeaderFormValues>);
            }
          }
        }}
      >
        <Form.Item name="batchNo" label="生产批号" rules={[{ required: true, message: '请输入生产批号' }]}>
          <Input maxLength={24} disabled={disabled} />
        </Form.Item>
        <Space size={12} style={{ display: 'flex' }} align="start">
          <Form.Item name="herbId" label="药材" rules={[{ required: true, message: '请选择药材' }]} style={{ flex: 1 }}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={disabled}
              options={herbs.map((h) => ({ label: `${h.name} · ${h.batchNo}（${h.feedKg}kg）`, value: h.id }))}
            />
          </Form.Item>
          <Form.Item name="methodId" label="炮制方法" rules={[{ required: true, message: '请选择炮制方法' }]} style={{ flex: 1 }}>
            <Select
              disabled={disabled}
              options={methods.map((m) => ({ label: `${m.name} · ${m.auxiliary} ${m.auxRatio}kg/100kg`, value: m.id }))}
            />
          </Form.Item>
        </Space>
        {watchedMethod ? (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 12 }}
            message={
              <Space wrap size={8}>
                <span>辅料比例 {watchedMethod.auxRatio}kg/100kg</span>
                <FireLevelTag level={watchedMethod.fireLevel} tempRange={watchedMethod.tempRange} duration={watchedMethod.duration} />
                <Tag>{watchedMethod.criterionDimension}</Tag>
              </Space>
            }
            description={`判断标准：${watchedMethod.criterion}；适用药材：${watchedMethod.applicable}`}
          />
        ) : null}
        <Space size={12} style={{ display: 'flex' }} align="start">
          <Form.Item name="fireLevel" label="火力" rules={[{ required: true, message: '请选择火力' }]}>
            <Select style={{ width: 120 }} disabled={disabled} options={FIRE_LEVELS.map((v) => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item name="feedKg" label="投料量(kg)" rules={[{ required: true, message: '请输入投料量' }]}>
            <InputNumber min={0} step={1} style={{ width: 150 }} disabled={disabled} />
          </Form.Item>
        </Space>
        <RatioCalculator
          auxRatio={watchedMethod?.auxRatio ?? 0}
          auxiliary={watchedMethod?.auxiliary ?? '无'}
          feedKg={Number(watched?.feedKg) || 0}
          auxUsedKg={Number(watched?.auxUsedKg) || 0}
          onChange={(patch) => {
            if (patch.feedKg !== undefined) formObj.setFieldsValue({ feedKg: patch.feedKg });
            if (patch.auxUsedKg !== undefined) formObj.setFieldsValue({ auxUsedKg: patch.auxUsedKg });
          }}
        />
        <Form.Item name="remark" label="批次备注" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} maxLength={80} disabled={disabled} />
        </Form.Item>
      </Form>
    );
  };

  const segmentFormItems = (target: ProcessSegment | undefined) => (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          segmentMode === 'add'
            ? '新段保存后先标记为「待接班」，由下一班确认后才能继续添加下一段'
            : `正在修改待接班的第 ${target?.seq ?? ''} 段，保存后仍需 ${target ? nextTeamOf(segWatched?.team ?? target.team) : ''} 接班确认`
        }
      />
      <Space size={12} style={{ display: 'flex' }} align="start">
        <Form.Item name="team" label="本段班组" rules={[{ required: true, message: '请选择班组' }]}>
          <Select style={{ width: 110 }} options={SEGMENT_TEAM_OPTIONS} />
        </Form.Item>
        <Form.Item name="temp" label="锅温(℃)" rules={[{ required: true, message: '请输入锅温' }]}>
          <InputNumber min={0} max={800} style={{ width: 130 }} />
        </Form.Item>
        <Form.Item name="durationMin" label="时长(min)" rules={[{ required: true, message: '请输入时长' }]}>
          <InputNumber min={0} style={{ width: 130 }} />
        </Form.Item>
      </Space>
      <Space size={12} style={{ display: 'flex' }} align="start">
        <Form.Item name="startedAt" label="本段开始" rules={[{ required: true, message: '请选择开始时间' }]}>
          <DatePicker showTime style={{ width: 190 }} />
        </Form.Item>
        <Form.Item name="endedAt" label="交班时间" rules={[{ required: true, message: '请选择交班时间' }]}>
          <DatePicker showTime style={{ width: 190 }} />
        </Form.Item>
      </Space>
      <Form.Item name="handover" label="交接说明（做到哪里、下一班注意事项）" rules={[{ required: true, message: '请填写交接说明' }]}>
        <Input.TextArea rows={3} maxLength={120} placeholder="例如：麦麸已撒匀，表面刚转黄，下一班中火续炒至麸香透出" />
      </Form.Item>
    </>
  );

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        炮制工序记录台
      </Title>
      <Paragraph type="secondary">
        炮制常跨班完成：每段登记班组、锅温、时长与交接说明；新增段先标记「待接班」，下一班确认后才能继续；全部段确认后按累计时长与最终重量判定得率与程度，这时才允许锁定。未确认的批次在列表标出正在等待的班组。
      </Paragraph>

      <Space style={{ marginBottom: 12 }} wrap>
        <Button type="primary" onClick={openCreate}>
          新建工序记录
        </Button>
        <Button onClick={() => setShowRules((v) => !v)}>{showRules ? '收起程度判定规则' : '查看程度判定规则'}</Button>
      </Space>

      {showRules ? (
        <Card size="small" style={{ marginBottom: 12 }} title="炮制程度判定规则">
          <Table
            rowKey="degree"
            size="small"
            pagination={false}
            dataSource={DEGREE_RULES}
            columns={[
              { title: '程度', dataIndex: 'degree', width: 90, render: (v: ProcessDegree) => <Tag color={DEGREE_COLOR[v]}>{v}</Tag> },
              { title: '判定条件', dataIndex: 'condition' },
              { title: '处置', dataIndex: 'action', width: 280 },
            ]}
          />
        </Card>
      ) : null}

      <FilterBar
        fields={[
          { key: 'origin', label: '基原', options: HERB_ORIGINS, width: 110 },
          { key: 'part', label: '药用部位', options: HERB_PARTS, width: 110 },
          { key: 'degree', label: '程度', options: PROCESS_DEGREES, width: 110 },
        ]}
        resultCount={visibleBatches.length}
        totalCount={batches.length}
        keywordPlaceholder="搜索药材名 / 批号"
      />

      {visibleBatches.length === 0 ? (
        <EmptyPanel description="没有符合条件的工序记录" actionText="新建一条工序记录" onAction={openCreate} />
      ) : (
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={visibleBatches}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1500 }}
        />
      )}

      {/* 新建：表头 + 首段（待接班） */}
      <Modal
        open={createOpen}
        title="新建炮制工序记录"
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        okText="登记首段（待接班）"
        cancelText="取消"
        width={720}
      >
        {renderHeaderForm(createForm, createWatched, true)}
        <Divider orientation="left" style={{ margin: '4px 0 12px' }}>
          首段登记
        </Divider>
        <Form form={createSegForm} layout="vertical">
          {segmentFormItems(undefined)}
        </Form>
      </Modal>

      {/* 详情：表头 / 分段时间线 / 接班确认 / 完工判定 */}
      <Modal
        open={Boolean(liveDetail)}
        title={liveDetail ? `工序记录 · ${liveDetail.batchNo}` : ''}
        onCancel={closeDetail}
        footer={
          segmentMode === 'none' && !confirmTarget
            ? [
                <Button key="close" onClick={closeDetail}>
                  关闭
                </Button>,
              ]
            : confirmTarget
              ? [
                  <Button
                    key="finish"
                    onClick={() => {
                      confirmForm.setFieldValue('confirmedBy', confirmTarget.team);
                      submitConfirm();
                    }}
                  >
                    本班完工确认（{confirmTarget.team}）
                  </Button>,
                  <Button key="cancel" onClick={() => setConfirmTarget(null)}>
                    取消
                  </Button>,
                  <Button key="ok" type="primary" onClick={submitConfirm}>
                    {confirmTarget.awaitTeam}接班确认
                  </Button>,
                ]
              : [
                  <Button key="cancel" onClick={() => {
                    setSegmentMode('none');
                    setEditSegment(null);
                  }}>
                    取消
                  </Button>,
                  <Button key="ok" type="primary" onClick={submitSegment}>
                    保存
                  </Button>,
                ]
        }
        width={780}
      >
        {liveDetail ? (
          liveDetail.locked && !qcMode ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="该批得率与程度已锁定，仅质检员可改"
              action={<Switch checkedChildren="质检员改判" unCheckedChildren="只读" checked={qcMode} onChange={setQcMode} />}
            />
          ) : liveDetail.locked ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="质检员改判模式：保存表头或改判得率、程度将记录质检员操作"
              action={<Switch checkedChildren="质检员改判" unCheckedChildren="只读" checked={qcMode} onChange={setQcMode} />}
            />
          ) : null
        ) : null}

        {liveDetail && segmentMode === 'none' && !confirmTarget ? (
          <>
            {renderHeaderForm(headerForm, headerWatched)}
            <Space style={{ marginBottom: 8 }}>
              <Button size="small" onClick={submitHeader} disabled={headerReadonly()}>
                保存表头
              </Button>
            </Space>

            <Divider orientation="left" style={{ margin: '8px 0' }}>
              工序分段（{liveDetail.segments.length} 段 · 累计 {totalDuration(liveDetail)}min）
            </Divider>
            <Timeline
              items={liveDetail.segments.map((seg) => ({
                color: seg.status === '已确认' ? 'green' : 'orange',
                children: (
                  <div>
                    <Space wrap size={6}>
                      <Text strong>
                        第 {seg.seq} 段 · {seg.team}
                      </Text>
                      {seg.status === '已确认' ? (
                        <Tag color="green">已确认{seg.confirmedBy ? ` · ${seg.confirmedBy}` : ''}</Tag>
                      ) : (
                        <Tag color="orange">待接班 · 等{seg.awaitTeam}</Tag>
                      )}
                    </Space>
                    <div style={{ fontSize: 12, color: '#6b7a70', margin: '2px 0' }}>
                      {dayjs(seg.startedAt).format('MM-DD HH:mm')} ~ {dayjs(seg.endedAt).format('MM-DD HH:mm')} · 锅温 {seg.temp}℃ · 时长{' '}
                      {seg.durationMin}min
                    </div>
                    <div style={{ fontSize: 13 }}>交接：{seg.handover}</div>
                    {seg.status === '待接班' && !liveDetail.locked ? (
                      <Space size={4} style={{ marginTop: 4 }}>
                        <Button size="small" type="link" onClick={() => openConfirm(seg)}>
                          {seg.awaitTeam}接班确认
                        </Button>
                        <Button size="small" type="link" onClick={() => openEditSegment(seg)}>
                          修改本段
                        </Button>
                      </Space>
                    ) : null}
                  </div>
                ),
              }))}
            />

            <Space style={{ marginBottom: 12 }}>
              <Button size="small" disabled={liveDetail.locked || !allConfirmed(liveDetail)} onClick={openAddSegment}>
                新增一段（本班交接给下一班）
              </Button>
              {!allConfirmed(liveDetail) ? (
                <Text type="warning" style={{ fontSize: 12 }}>
                  仍有待接片段，下一班确认后才能继续添加
                </Text>
              ) : null}
            </Space>

            {allConfirmed(liveDetail) ? (
              <Card
                size="small"
                title="完工判定（全部段已确认）"
                extra={
                  liveDetail.locked && !qcMode ? <Tag color="blue">已锁定</Tag> : <Tag color="green">可判定</Tag>
                }
              >
                <Form form={finalizeForm} layout="vertical" component="div">
                  <Space size={12} style={{ display: 'flex' }} align="start">
                    <Form.Item
                      name="outputKg"
                      label="最终重量(kg)"
                      rules={[{ required: true, message: '请输入最终重量' }]}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber min={0} step={0.5} style={{ width: 160 }} disabled={liveDetail.locked && !qcMode} />
                    </Form.Item>
                    <Form.Item name="degree" label="程度判定" rules={[{ required: true, message: '请选择程度' }]} style={{ marginBottom: 8 }}>
                      <Select
                        style={{ width: 140 }}
                        disabled={liveDetail.locked && !qcMode}
                        options={PROCESS_DEGREES.map((v) => ({ label: v, value: v }))}
                      />
                    </Form.Item>
                  </Space>
                </Form>
                <Alert
                  type={detailVerdict?.verdict.degree === '适中' ? 'success' : detailVerdict?.verdict.degree === '太过' ? 'error' : 'warning'}
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={`按累计时长 ${totalDuration(liveDetail)}min、末段锅温 ${
                    liveDetail.segments[liveDetail.segments.length - 1].temp
                  }℃ 判定：${detailVerdict ? `${detailVerdict.verdict.degree}（得率 ${detailVerdict.yieldRate}%，预期 ${detailVerdict.verdict.expectedYield}%）` : '请录入最终重量'}`}
                  description={
                    detailVerdict ? (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {detailVerdict.verdict.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    ) : (
                      '录入最终重量后自动给出得率与程度建议，可按判断标准复核后修改'
                    )
                  }
                />
                <Space>
                  <Button
                    type="primary"
                    disabled={liveDetail.locked && !qcMode}
                    onClick={() => submitFinalize(true)}
                  >
                    {liveDetail.locked ? '质检员改判并锁定' : '完工判定并锁定'}
                  </Button>
                  {!liveDetail.locked ? (
                    <Button onClick={() => submitFinalize(false)}>仅保存判定</Button>
                  ) : null}
                </Space>
              </Card>
            ) : (
              <Alert
                type="warning"
                showIcon
                message={`第 ${liveDetail.segments.find((s) => s.status === '待接班')?.seq ?? ''} 段等待 ${awaitingTeam(liveDetail)} 接班确认，全部段确认后才能录入最终重量并判定锁定`}
              />
            )}
          </>
        ) : null}

        {/* 新增 / 修改段 */}
        {liveDetail && segmentMode !== 'none' && !confirmTarget ? (
          <Form form={segForm} layout="vertical">
            {segmentFormItems(editSegment ?? liveDetail.segments.find((s) => s.status === '待接班'))}
          </Form>
        ) : null}

        {/* 接班确认 */}
        {liveDetail && confirmTarget ? (
          <Form form={confirmForm} layout="vertical">
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${confirmTarget.team} 交接：${confirmTarget.handover}`}
              description={`锅温 ${confirmTarget.temp}℃ · 时长 ${confirmTarget.durationMin}min · 交班 ${dayjs(confirmTarget.endedAt).format(
                'MM-DD HH:mm',
              )}`}
            />
            <Form.Item name="confirmedBy" label={`接班班组 / 确认人（应为 ${confirmTarget.awaitTeam}）`} rules={[{ required: true, message: '请填写接班确认人' }]}>
              <Input maxLength={16} placeholder={confirmTarget.awaitTeam} />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}
