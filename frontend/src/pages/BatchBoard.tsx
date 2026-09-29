import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import FilterBar from '../components/common/FilterBar';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import SegmentPanel from '../components/common/SegmentPanel';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHerbFilter } from '../hooks/useHerbFilter';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { HERB_ORIGINS, HERB_PARTS } from '../types/herb-material';
import { FIRE_LEVELS, type FireLevel } from '../types/processing-method';
import { DEFAULT_TEAMS, PROCESS_DEGREES, type ProcessBatch, type ProcessDegree, type ProcessSegment } from '../types/process-batch';
import { DEGREE_RULES, judgeDegree, suggestedValues } from '../utils/degree';
import { allConfirmed, batchPhase, calcYieldRate, pendingSegment, teamChain, totalDuration, waitingTeam } from '../utils/segment';

const { Title, Paragraph, Text } = Typography;

type ModalMode = 'edit' | 'addSegment' | 'confirm' | 'finalize';

interface BatchFormValues {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: FireLevel;
  startedAt: Dayjs;
  team: string;
  nextTeam?: string;
  temp: number;
  durationMin: number;
  handoverNote?: string;
  remark?: string;
}

interface SegmentFormValues {
  team: string;
  nextTeam?: string;
  temp: number;
  durationMin: number;
  handoverNote?: string;
  startedAt: Dayjs;
}

interface ConfirmFormValues {
  confirmedBy: string;
}

interface FinalizeFormValues {
  outputKg: number;
  degree: ProcessDegree;
}

const DEGREE_COLOR: Record<ProcessDegree, string> = { 不及: 'orange', 适中: 'green', 太过: 'red' };
const teamOptions = DEFAULT_TEAMS.map((t) => ({ label: t, value: t }));

/** 工序记录台：跨班分段、接班确认，全部段确认后按累计时长与最终重量判定得率与程度 */
export default function BatchBoard() {
  const { message } = AntApp.useApp();
  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const createBatch = useBatchStore((s) => s.createBatch);
  const updateBatch = useBatchStore((s) => s.updateBatch);
  const addSegment = useBatchStore((s) => s.addSegment);
  const confirmSegment = useBatchStore((s) => s.confirmSegment);
  const finalizeBatch = useBatchStore((s) => s.finalizeBatch);
  const lockBatch = useBatchStore((s) => s.lockBatch);
  const unlockAsQc = useBatchStore((s) => s.unlockAsQc);
  const removeBatch = useBatchStore((s) => s.removeBatch);

  const herbFilter = useHerbFilter();
  const [params] = useSearchParams();
  const degreeParam = params.get('degree') ?? '';

  const [editForm] = Form.useForm<BatchFormValues>();
  const [segForm] = Form.useForm<SegmentFormValues>();
  const [confirmForm] = Form.useForm<ConfirmFormValues>();
  const [finalizeForm] = Form.useForm<FinalizeFormValues>();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>('edit');
  const [editing, setEditing] = useState<ProcessBatch | null>(null);
  const [segTarget, setSegTarget] = useState<ProcessSegment | null>(null);
  const [qcMode, setQcMode] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const isCreate = mode === 'edit' && !editing;
  const editWatched = Form.useWatch([], editForm) as Partial<BatchFormValues> | undefined;
  const finalizeWatched = Form.useWatch([], finalizeForm) as Partial<FinalizeFormValues> | undefined;

  const watchedMethod = methods.find((m) => m.id === (editWatched?.methodId ?? editing?.methodId ?? ''));
  const editFeedKg = Number(editWatched?.feedKg) ?? editing?.feedKg ?? 0;

  const finalizeVerdict = useMemo(() => {
    if (!editing) return undefined;
    const method = methods.find((m) => m.id === editing.methodId);
    if (!method) return undefined;
    const output = Number(finalizeWatched?.outputKg) || 0;
    const yieldRate = calcYieldRate(editing.feedKg, output);
    const last = editing.segments[editing.segments.length - 1];
    return judgeDegree({
      method,
      fireLevel: editing.fireLevel,
      duration: totalDuration(editing),
      temp: last?.temp ?? suggestedValues(method).temp,
      yieldRate,
    });
  }, [editing, methods, finalizeWatched?.outputKg]);

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

  // ---------- 新建（首段待接班） ----------
  const openCreate = () => {
    setMode('edit');
    setEditing(null);
    setSegTarget(null);
    setQcMode(false);
    editForm.resetFields();
    const firstHerb = herbs[0];
    const firstMethod = methods[0];
    const now = dayjs();
    editForm.setFieldsValue({
      batchNo: `PZ-${dayjs().format('YYMMDD')}-${String(batches.length + 1).padStart(2, '0')}`,
      herbId: firstHerb?.id,
      methodId: firstMethod?.id,
      feedKg: firstHerb?.feedKg ?? 100,
      auxUsedKg: Number((((firstHerb?.feedKg ?? 100) * (firstMethod?.auxRatio ?? 0)) / 100).toFixed(2)),
      fireLevel: firstMethod?.fireLevel ?? '文火',
      startedAt: now.subtract(20, 'minute'),
      team: DEFAULT_TEAMS[0],
      nextTeam: DEFAULT_TEAMS[1],
      temp: firstMethod ? Math.round((firstMethod.tempRange[0] + firstMethod.tempRange[1]) / 2) : 100,
      durationMin: firstMethod?.duration ?? 12,
      handoverNote: '',
    } as unknown as BatchFormValues);
    setOpen(true);
  };

  // ---------- 编辑表头 / 质检员改判 ----------
  const openEdit = (record: ProcessBatch) => {
    setMode('edit');
    setEditing(record);
    setSegTarget(null);
    setQcMode(false);
    editForm.resetFields();
    editForm.setFieldsValue({
      batchNo: record.batchNo,
      herbId: record.herbId,
      methodId: record.methodId,
      feedKg: record.feedKg,
      auxUsedKg: record.auxUsedKg,
      fireLevel: record.fireLevel,
      startedAt: dayjs(record.startedAt),
      team: record.segments[0]?.team ?? '',
      temp: record.segments[0]?.temp,
      durationMin: record.segments[0]?.durationMin,
      handoverNote: record.segments[0]?.handoverNote,
      remark: record.remark,
    } as unknown as BatchFormValues);
    setOpen(true);
  };

  // ---------- 接续一段 ----------
  const openAddSegment = (record: ProcessBatch) => {
    setMode('addSegment');
    setEditing(record);
    setSegTarget(null);
    segForm.resetFields();
    const method = methodOf(record.methodId);
    const prev = record.segments[record.segments.length - 1];
    segForm.setFieldsValue({
      team: prev?.nextTeam ?? DEFAULT_TEAMS.find((t) => t !== prev?.team) ?? DEFAULT_TEAMS[0],
      nextTeam: DEFAULT_TEAMS.find((t) => t !== prev?.team && t !== prev?.nextTeam),
      temp: method ? Math.round((method.tempRange[0] + method.tempRange[1]) / 2) : 100,
      durationMin: method?.duration ?? 12,
      handoverNote: '',
      startedAt: dayjs(),
    } as unknown as SegmentFormValues);
    setOpen(true);
  };

  // ---------- 接班确认 ----------
  const openConfirm = (record: ProcessBatch, segment: ProcessSegment) => {
    setMode('confirm');
    setEditing(record);
    setSegTarget(segment);
    confirmForm.resetFields();
    confirmForm.setFieldsValue({ confirmedBy: segment.nextTeam ?? '' } as unknown as ConfirmFormValues);
    setOpen(true);
  };

  // ---------- 完工判定 ----------
  const openFinalize = (record: ProcessBatch) => {
    if (!allConfirmed(record)) {
      message.warning('尚有分段未接班确认，不能录入最终重量');
      return;
    }
    setMode('finalize');
    setEditing(record);
    setSegTarget(null);
    finalizeForm.resetFields();
    finalizeForm.setFieldsValue({
      outputKg: Number((record.feedKg * 0.94).toFixed(1)),
      degree: '适中',
    } as unknown as FinalizeFormValues);
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setSegTarget(null);
    setQcMode(false);
  };

  const submit = async () => {
    if (!editing && mode !== 'edit') return;

    if (mode === 'edit') {
      const values = await editForm.validateFields();
      if (isCreate) {
        const nowIso = new Date().toISOString();
        await createBatch({
          batchNo: values.batchNo,
          herbId: values.herbId,
          methodId: values.methodId,
          feedKg: Number(values.feedKg) || 0,
          auxUsedKg: Number(values.auxUsedKg) || 0,
          fireLevel: values.fireLevel,
          startedAt: values.startedAt.toISOString(),
          endedAt: nowIso,
          remark: values.remark,
          firstSegment: {
            team: values.team,
            nextTeam: values.nextTeam,
            temp: Number(values.temp) || 0,
            durationMin: Number(values.durationMin) || 0,
            handoverNote: values.handoverNote,
            startedAt: values.startedAt.toISOString(),
            endedAt: nowIso,
          },
        });
        message.success(`已登记 ${values.batchNo}，首段待${values.nextTeam ? ` ${values.nextTeam} ` : ''}接班确认`);
        closeModal();
        return;
      }

      // 编辑表头（完工判定后只允许质检员改判）
      const record = editing as ProcessBatch;
      const locked = record.locked && !qcMode;
      if (locked) {
        message.error('该批已锁定，请打开「质检员改判」后再提交');
        return;
      }
      const ok = await updateBatch(
        record.id,
        {
          batchNo: values.batchNo,
          herbId: values.herbId,
          methodId: values.methodId,
          feedKg: Number(values.feedKg) || 0,
          auxUsedKg: Number(values.auxUsedKg) || 0,
          fireLevel: values.fireLevel,
          remark: values.remark,
        },
        qcMode,
      );
      if (!ok) {
        message.error('保存失败');
        return;
      }
      message.success(`已更新 ${values.batchNo}`);
      closeModal();
      return;
    }

    const record = editing as ProcessBatch;

    if (mode === 'addSegment') {
      const values = await segForm.validateFields();
      const nowIso = new Date().toISOString();
      const ok = await addSegment(record.id, {
        team: values.team,
        nextTeam: values.nextTeam,
        temp: Number(values.temp) || 0,
        durationMin: Number(values.durationMin) || 0,
        handoverNote: values.handoverNote,
        startedAt: values.startedAt.toISOString(),
        endedAt: nowIso,
      });
      if (!ok) {
        message.error('上一段尚未接班确认，或该批已完工/锁定，不能接续新段');
        return;
      }
      message.success(`已新增 ${values.team} 分段，待${values.nextTeam ? ` ${values.nextTeam} ` : ''}接班确认`);
      closeModal();
      return;
    }

    if (mode === 'confirm') {
      const values = await confirmForm.validateFields();
      const seg = segTarget;
      if (!seg) return;
      const ok = await confirmSegment(record.id, seg.id, values.confirmedBy);
      if (!ok) {
        message.error('确认失败：该段不是待接班状态');
        return;
      }
      message.success(`${values.confirmedBy} 已接班确认第 ${seg.seq} 段`);
      closeModal();
      return;
    }

    if (mode === 'finalize') {
      const values = await finalizeForm.validateFields();
      const method = methodOf(record.methodId);
      if (!method) {
        message.error('缺少炮制方法，无法判定');
        return;
      }
      const ok = await finalizeBatch(record.id, Number(values.outputKg) || 0, method, values.degree);
      if (!ok) {
        message.error('完工判定失败：请确认全部段已接班确认且最终重量大于 0');
        return;
      }
      message.success(`已完工判定 ${record.batchNo}，可锁定该批`);
      closeModal();
    }
  };

  const handleLock = async (record: ProcessBatch) => {
    const ok = await lockBatch(record.id);
    if (ok) {
      message.success('已锁定该批');
    } else {
      message.warning('全部段确认并完成得率/程度判定后，才允许锁定');
    }
  };

  const columns: TableColumnsType<ProcessBatch> = [
    { title: '生产批号', dataIndex: 'batchNo', width: 130, fixed: 'left', render: (v: string) => <Text strong>{v}</Text> },
    { title: '药材', dataIndex: 'herbId', width: 90, render: (id: string) => herbName(id) },
    { title: '方法', dataIndex: 'methodId', width: 90, render: (id: string) => methodOf(id)?.name ?? '-' },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 190,
      render: (v: FireLevel, record) => (
        <FireLevelTag level={v} tempRange={methodOf(record.methodId)?.tempRange} duration={methodOf(record.methodId)?.duration} />
      ),
    },
    { title: '投料(kg)', dataIndex: 'feedKg', width: 90, align: 'right' },
    { title: '辅料(kg)', dataIndex: 'auxUsedKg', width: 90, align: 'right' },
    {
      title: '累计时长',
      width: 90,
      align: 'right',
      render: (_, record) => <Text strong>{totalDuration(record)}</Text>,
    },
    {
      title: '得率(%)',
      dataIndex: 'yieldRate',
      width: 90,
      align: 'right',
      render: (v?: number) => (v === undefined ? <Text type="secondary">待判定</Text> : <Text type={v < 85 ? 'danger' : undefined}>{v}</Text>),
    },
    {
      title: '程度',
      dataIndex: 'degree',
      width: 80,
      render: (v?: ProcessDegree) => (v ? <Tag color={DEGREE_COLOR[v]}>{v}</Tag> : <Text type="secondary">待判定</Text>),
    },
    {
      title: '状态',
      width: 160,
      render: (_, record) => {
        const phase = batchPhase(record);
        if (phase === 'locked') return <Tag color="blue">已锁定{record.qcBy ? ` · ${record.qcBy}` : ''}</Tag>;
        if (phase === 'finalized') return <Tag color="cyan">已判定 · 待锁定</Tag>;
        if (phase === 'ready') return <Tag color="green">全部段已确认 · 待判定</Tag>;
        const team = waitingTeam(record);
        return <Tag color="orange">待接班{team ? ` · 等${team}` : ''}</Tag>;
      },
    },
    {
      title: '班组交接',
      width: 150,
      render: (_, record) => {
        const chains = teamChain(record);
        const pending = pendingSegment(record);
        return (
          <Space size={4} wrap>
            {chains.map((team, i) => (
              <span key={team}>
                {i > 0 ? <Text type="secondary"> → </Text> : null}
                <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                  {team}
                </Tag>
              </span>
            ))}
            {pending?.nextTeam ? (
              <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                → {pending.nextTeam}
              </Tag>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '操作',
      width: 210,
      fixed: 'right',
      render: (_, record) => {
        const phase = batchPhase(record);
        const pending = pendingSegment(record);
        return (
          <Space size={2} wrap>
            <Button size="small" type="link" onClick={() => openEdit(record)}>
              {record.locked ? '质检改判' : '编辑'}
            </Button>
            {pending ? (
              <Button size="small" type="link" onClick={() => openConfirm(record, pending)}>
                接班确认
              </Button>
            ) : null}
            {phase === 'ready' ? (
              <>
                <Button size="small" type="link" onClick={() => openAddSegment(record)}>
                  接续一段
                </Button>
                <Button size="small" type="link" onClick={() => openFinalize(record)}>
                  完工判定
                </Button>
              </>
            ) : null}
            {phase === 'finalized' ? (
              <Button size="small" type="link" onClick={() => handleLock(record)}>
                锁定
              </Button>
            ) : null}
            {phase === 'locked' ? (
              <Button
                size="small"
                type="link"
                onClick={() => unlockAsQc(record.id, '质检员 · 赵敏').then(() => message.success('质检员已放行，可重新改判'))}
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
        );
      },
    },
  ];

  const modalTitle = (() => {
    if (mode === 'addSegment') return `接续分段 · ${editing?.batchNo ?? ''}`;
    if (mode === 'confirm') return `接班确认 · ${editing?.batchNo ?? ''} 第 ${segTarget?.seq ?? ''} 段`;
    if (mode === 'finalize') return `完工判定 · ${editing?.batchNo ?? ''}`;
    return editing ? `工序记录 · ${editing.batchNo}` : '新建炮制工序记录（首段）';
  })();

  const modalOkText =
    mode === 'addSegment'
      ? '提交分段（待接班确认）'
      : mode === 'confirm'
        ? '确认接班'
        : mode === 'finalize'
          ? '判定完成'
          : editing
            ? '保存'
            : '提交（首段待接班）';

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        炮制工序记录台
      </Title>
      <Paragraph type="secondary">
        炮制跨班完成时按段记录：每段填写班组、锅温、时长与交接说明，新增段先标记待接班，下一班确认后才能继续；全部段确认后按累计时长与最终重量判定得率与程度，这时才允许锁定。
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
          scroll={{ x: 1560 }}
          expandable={{
            expandedRowRender: (record) => (
              <SegmentPanel
                batch={record}
                onConfirmSegment={(seg) => openConfirm(record, seg)}
                onAddSegment={() => openAddSegment(record)}
                onFinalize={() => openFinalize(record)}
              />
            ),
            rowExpandable: () => true,
          }}
        />
      )}

      <Modal
        open={open}
        title={modalTitle}
        onCancel={closeModal}
        onOk={submit}
        okText={modalOkText}
        cancelText="取消"
        width={760}
        destroyOnClose
      >
        {/* ---------- 新建 / 编辑表头 ---------- */}
        {mode === 'edit' ? (
          <Form
            form={editForm}
            layout="vertical"
            onValuesChange={(changed) => {
              if ('methodId' in changed) {
                const method = methods.find((m) => m.id === changed.methodId);
                if (method) {
                  const suggestion = suggestedValues(method);
                  const feed = Number(editForm.getFieldValue('feedKg')) || 0;
                  editForm.setFieldsValue({
                    fireLevel: method.fireLevel,
                    temp: suggestion.temp,
                    durationMin: suggestion.duration,
                    auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
                  } as unknown as BatchFormValues);
                }
              }
              if ('feedKg' in changed) {
                const method = methods.find((m) => m.id === editForm.getFieldValue('methodId'));
                if (method) {
                  const feed = Number(changed.feedKg) || 0;
                  editForm.setFieldsValue({
                    auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
                  } as unknown as BatchFormValues);
                }
              }
            }}
          >
            {editing?.locked ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="该批得率与程度已锁定，仅质检员可改"
                action={<Switch checkedChildren="质检员改判" unCheckedChildren="只读" checked={qcMode} onChange={setQcMode} />}
              />
            ) : null}

            {isCreate ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="首段提交后先标记「待接班」，需下一班接班确认；未确认期间不能继续加段或完工判定。"
              />
            ) : null}

            <Form.Item name="batchNo" label="生产批号" rules={[{ required: true, message: '请输入生产批号' }]}>
              <Input maxLength={24} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>

            <Space size={12} style={{ display: 'flex' }} align="start">
              <Form.Item name="herbId" label="药材" rules={[{ required: true, message: '请选择药材' }]} style={{ flex: 1 }}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  disabled={Boolean(editing?.locked) && !qcMode}
                  options={herbs.map((h) => ({ label: `${h.name} · ${h.batchNo}（${h.feedKg}kg）`, value: h.id }))}
                />
              </Form.Item>
              <Form.Item name="methodId" label="炮制方法" rules={[{ required: true, message: '请选择炮制方法' }]} style={{ flex: 1 }}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  disabled={Boolean(editing) && !qcMode}
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

            <RatioCalculator
              auxRatio={watchedMethod?.auxRatio ?? 0}
              auxiliary={watchedMethod?.auxiliary ?? '无'}
              feedKg={editFeedKg}
              auxUsedKg={Number(editWatched?.auxUsedKg) || 0}
              onChange={(patch) => {
                if (patch.feedKg !== undefined) {
                  editForm.setFieldsValue({ feedKg: patch.feedKg } as unknown as BatchFormValues);
                }
                if (patch.auxUsedKg !== undefined) {
                  editForm.setFieldsValue({ auxUsedKg: patch.auxUsedKg } as unknown as BatchFormValues);
                }
              }}
            />

            <Form.Item name="feedKg" label="投料量(kg)" rules={[{ required: true, message: '请输入投料量' }]} style={{ maxWidth: 220, marginTop: 12 }}>
              <InputNumber min={0} step={1} style={{ width: '100%' }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>

            {isCreate ? (
              <>
                <Card size="small" style={{ marginTop: 12, marginBottom: 12 }} title="第一段（本班作业，提交后待接班）">
                  <Space size={12} style={{ display: 'flex' }} align="start" wrap>
                    <Form.Item name="team" label="作业班组" rules={[{ required: true, message: '请选择/填写班组' }]}>
                      <Select style={{ width: 120 }} showSearch options={teamOptions} />
                    </Form.Item>
                    <Form.Item name="nextTeam" label="等待接班班组">
                      <Select style={{ width: 140 }} allowClear showSearch options={teamOptions} placeholder="不指定则任意班组" />
                    </Form.Item>
                    <Form.Item name="temp" label="实际锅温(℃)" rules={[{ required: true, message: '请输入实际锅温' }]}>
                      <InputNumber min={0} max={800} style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item name="durationMin" label="本段时长(min)" rules={[{ required: true, message: '请输入本段时长' }]}>
                      <InputNumber min={0} style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item name="startedAt" label="本段开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
                      <DatePicker showTime style={{ width: 200 }} />
                    </Form.Item>
                  </Space>
                  <Form.Item name="handoverNote" label="交接说明（火候/色泽/下一班注意事项）">
                    <Input.TextArea rows={2} maxLength={120} placeholder="如：麦麸已下，色泽初转黄，乙班续炒至麸香出锅" />
                  </Form.Item>
                </Card>
              </>
            ) : (
              <Card size="small" style={{ marginTop: 12, marginBottom: 12 }} title={`分段概况（共 ${editing?.segments.length ?? 0} 段，累计 ${editing ? totalDuration(editing) : 0} min）`}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {editing?.segments.map((seg) => (
                    <Space key={seg.id} size={8} wrap>
                      <Tag>第{seg.seq}段</Tag>
                      <Tag color="geekblue">{seg.team}</Tag>
                      <Text type="secondary">
                        {seg.temp}℃ · {seg.durationMin}min
                      </Text>
                      {seg.status === '已确认' ? (
                        <Tag color="green">已确认{seg.confirmedBy ? ` · ${seg.confirmedBy}` : ''}</Tag>
                      ) : (
                        <Tag color="orange">待接班{seg.nextTeam ? ` · 等${seg.nextTeam}` : ''}</Tag>
                      )}
                      {seg.handoverNote ? <Text type="secondary">{seg.handoverNote}</Text> : null}
                    </Space>
                  ))}
                  {editing?.finalized ? (
                    <Text type="secondary">
                      最终重量 {editing.outputKg ?? '-'} kg · 得率 {editing.yieldRate ?? '-'}% · 程度{' '}
                      {editing.degree ? <Tag color={DEGREE_COLOR[editing.degree]}>{editing.degree}</Tag> : '待判定'}
                      {editing.locked ? '（已锁定，质检员改判可调整最终重量与程度）' : ''}
                    </Text>
                  ) : null}
                </Space>
              </Card>
            )}

            <Space size={12} style={{ display: 'flex' }} align="start">
              <Form.Item name="fireLevel" label="火力" rules={[{ required: true, message: '请选择火力' }]}>
                <Select style={{ width: 120 }} disabled={Boolean(editing?.locked) && !qcMode} options={FIRE_LEVELS.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Space>

            <Form.Item name="remark" label="备注">
              <Input.TextArea rows={2} maxLength={80} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>

            {editing?.locked && qcMode && editing.finalized ? (
              <QcRejudgeForm batch={editing} />
            ) : null}
          </Form>
        ) : null}

        {/* ---------- 接续一段 ---------- */}
        {mode === 'addSegment' && editing ? (
          <Form
            form={segForm}
            layout="vertical"
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`上一段已由 ${editing.segments[editing.segments.length - 1]?.confirmedBy ?? '接班班组'} 确认；新段提交后先标记待接班。`}
            />
            <Space size={12} style={{ display: 'flex' }} align="start" wrap>
              <Form.Item name="team" label="本班作业班组" rules={[{ required: true, message: '请选择/填写班组' }]}>
                <Select style={{ width: 140 }} showSearch options={teamOptions} />
              </Form.Item>
              <Form.Item name="nextTeam" label="完成后交予班组">
                <Select style={{ width: 140 }} allowClear showSearch options={teamOptions} placeholder="不指定则任意班组" />
              </Form.Item>
              <Form.Item name="temp" label="实际锅温(℃)" rules={[{ required: true, message: '请输入实际锅温' }]}>
                <InputNumber min={0} max={800} style={{ width: 130 }} />
              </Form.Item>
              <Form.Item name="durationMin" label="本段时长(min)" rules={[{ required: true, message: '请输入本段时长' }]}>
                <InputNumber min={0} style={{ width: 130 }} />
              </Form.Item>
              <Form.Item name="startedAt" label="本段开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
                <DatePicker showTime style={{ width: 200 }} />
              </Form.Item>
            </Space>
            <Form.Item name="handoverNote" label="交接说明">
              <Input.TextArea rows={3} maxLength={120} placeholder="本段火候、药材状态与给下一班的注意事项" />
            </Form.Item>
          </Form>
        ) : null}

        {/* ---------- 接班确认 ---------- */}
        {mode === 'confirm' && editing && segTarget ? (
          <Form form={confirmForm} layout="vertical">
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`第 ${segTarget.seq} 段由 ${segTarget.team} 交班，锅温 ${segTarget.temp}℃、时长 ${segTarget.durationMin}min，正等待接班确认`}
              description={segTarget.handoverNote || '无交接说明'}
            />
            <Form.Item name="confirmedBy" label="接班确认班组 / 人" rules={[{ required: true, message: '请选择或填写接班班组' }]}>
              <Select style={{ width: 240 }} showSearch options={teamOptions} placeholder="选择或输入接班班组" />
            </Form.Item>
            <Text type="secondary">确认后才能接续下一段；若为本批最后一段，确认后即可录入最终重量、判定得率与程度。</Text>
          </Form>
        ) : null}

        {/* ---------- 完工判定 ---------- */}
        {mode === 'finalize' && editing ? (
          <Form
            form={finalizeForm}
            layout="vertical"
            onValuesChange={(changed) => {
              if ('outputKg' in changed && finalizeVerdict) {
                finalizeForm.setFieldsValue({ degree: finalizeVerdict.degree } as unknown as FinalizeFormValues);
              }
            }}
          >
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={`全部 ${editing.segments.length} 段已接班确认，累计炮制 ${totalDuration(editing)} min；按累计时长与炮制后最终重量判定得率与程度。`}
            />
            <Space size={12} style={{ display: 'flex' }} align="start" wrap>
              <Form.Item label="投料量(kg)">
                <InputNumber value={editing.feedKg} disabled style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="outputKg" label="炮制后最终重量(kg)" rules={[{ required: true, message: '请输入最终重量' }]}>
                <InputNumber min={0} step={0.5} style={{ width: 180 }} />
              </Form.Item>
            </Space>
            <Alert
              type={finalizeVerdict?.degree === '适中' ? 'success' : finalizeVerdict?.degree === '太过' ? 'error' : 'warning'}
              showIcon
              style={{ marginBottom: 12 }}
              message={`系统判定：${finalizeVerdict?.degree ?? '待录入最终重量'}（得率 ${
                calcYieldRate(editing.feedKg, Number(finalizeWatched?.outputKg) || 0)
              }%，预期 ${finalizeVerdict?.expectedYield ?? '-'}%；累计时长 ${totalDuration(editing)}min）`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(finalizeVerdict?.reasons ?? ['录入最终重量后自动判定']).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              }
            />
            <Form.Item name="degree" label="程度判定（可按判断标准复核后修改）" rules={[{ required: true, message: '请选择程度' }]}>
              <Select style={{ width: 200 }} options={PROCESS_DEGREES.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Text type="secondary">判定完成后返回列表，点击「锁定」封存该批；锁定仅质检员可放行改判。</Text>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}

/** 质检员改判：调整最终重量后按累计时长重算得率/程度 */
function QcRejudgeForm({ batch }: { batch: ProcessBatch }) {
  const updateBatch = useBatchStore((s) => s.updateBatch);
  const methods = useMethodStore((s) => s.methods);
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<{ outputKg: number; degree: ProcessDegree }>();
  const method = methods.find((m) => m.id === batch.methodId);
  const watchedOutput = Form.useWatch('outputKg', form) as number | undefined;
  const yieldRate = calcYieldRate(batch.feedKg, Number(watchedOutput) || 0);
  const verdict = method
    ? judgeDegree({
        method,
        fireLevel: batch.fireLevel,
        duration: totalDuration(batch),
        temp: batch.segments[batch.segments.length - 1]?.temp ?? suggestedValues(method).temp,
        yieldRate,
      })
    : undefined;

  return (
    <Card size="small" type="inner" title="质检员改判最终重量 / 程度" style={{ marginBottom: 12 }}>
      <Form
        form={form}
        layout="inline"
        initialValues={{ outputKg: batch.outputKg, degree: batch.degree }}
        onValuesChange={(changed) => {
          if ('outputKg' in changed && verdict) {
            form.setFieldsValue({ degree: verdict.degree });
          }
        }}
      >
        <Form.Item name="outputKg" label="最终重量(kg)" rules={[{ required: true }]}>
          <InputNumber min={0} step={0.5} style={{ width: 150 }} />
        </Form.Item>
        <Form.Item name="degree" label="程度" rules={[{ required: true }]}>
          <Select style={{ width: 120 }} options={PROCESS_DEGREES.map((v) => ({ label: v, value: v }))} />
        </Form.Item>
        <Form.Item>
          <Button
            type="primary"
            ghost
            onClick={async () => {
              const values = await form.validateFields();
              const ok = await updateBatch(batch.id, { outputKg: Number(values.outputKg) || 0, degree: values.degree }, true);
              if (ok) message.success(`质检员已改判：得率 ${yieldRate}%，程度 ${values.degree}`);
            }}
          >
            应用改判
          </Button>
        </Form.Item>
      </Form>
      {verdict ? <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>改判后得率 {yieldRate}%（预期 {verdict.expectedYield}%），系统建议：{verdict.degree}</Text> : null}
    </Card>
  );
}
